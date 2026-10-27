/**
 * Free AI provider: Cloudflare Workers AI behind our `ironman-ai` worker
 * (cloudflare/ai, POST /v1/chat). Implements the same ClaudePort as the Anthropic
 * adapter so coach, briefing and meal do not care which one runs:
 * - system prompt → `system` message; text/image blocks → OpenAI content parts
 *   (images as `data:` URLs); consecutive turns of the same role are merged
 *   (some chat templates require strict alternation);
 * - JSON Schema → strict `json_schema` (nullable as `type: [x, 'null']`, every
 *   property required, no additional properties, no `format`);
 * - effort low → `enable_thinking: false`, medium → true; maxTokens → max_completion_tokens;
 * - the answer text is cleaned (```fences, <think> blocks, prose around the JSON)
 *   so the existing JSON parsers work; finishReason 'max_tokens' → stopReason 'max_tokens'.
 * No npm imports and no Deno globals: `fetch` is injected (tests use a fake).
 */
import { isAbortLike, timeoutError } from '../coach/deadline.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { ClaudeContentBlock, ClaudeMessage, ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';

export { DEFAULT_WORKERS_MODEL } from '../ai/provider.ts';

export const QUOTA_MESSAGE = 'La IA gratuita ha llegado a su límite de hoy. Vuelve a intentarlo mañana.';

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface WorkersAiConfig {
  /** Worker base URL, e.g. https://ironman-ai.<tu-subdominio>.workers.dev */
  url: string;
  /** Same value as the worker's AI_SHARED_SECRET. */
  secret: string;
  model: string;
  fetch: FetchFn;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

type OpenAiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAiPart[];
}

function toPart(block: ClaudeContentBlock): OpenAiPart {
  return block.type === 'text'
    ? { type: 'text', text: block.text }
    : { type: 'image_url', image_url: { url: `data:${block.mediaType};base64,${block.base64}` } };
}

const asParts = (content: OpenAiMessage['content']): OpenAiPart[] => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);

function merge(a: OpenAiMessage, b: OpenAiMessage): OpenAiMessage {
  if (typeof a.content === 'string' && typeof b.content === 'string') return { role: a.role, content: `${a.content}\n\n${b.content}` };
  return { role: a.role, content: [...asParts(a.content), ...asParts(b.content)] };
}

/** System prompt first, then the turns (same-role neighbours merged). */
export function toChatMessages(system: string, messages: readonly ClaudeMessage[]): OpenAiMessage[] {
  const turns = messages.map((m): OpenAiMessage => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(toPart) }));
  const merged = turns.reduce<OpenAiMessage[]>((acc, m) => {
    const last = acc[acc.length - 1];
    return last && last.role === m.role ? [...acc.slice(0, -1), merge(last, m)] : [...acc, m];
  }, []);
  return [{ role: 'system', content: system }, ...merged];
}

/** `anyOf: [X, {type: 'null'}]` with a single-typed X → X with `type: [t, 'null']` (+ null in enum). */
function nullableToTypeArray(node: Obj): Obj | null {
  if (!Array.isArray(node.anyOf) || node.anyOf.length !== 2) return null;
  const nullIndex = node.anyOf.findIndex((s) => isObj(s) && s.type === 'null' && Object.keys(s).length === 1);
  const other = node.anyOf[1 - nullIndex];
  if (nullIndex === -1 || !isObj(other) || typeof other.type !== 'string') return null;
  const inner = toStrictSchema(other) as Obj;
  return {
    ...(typeof node.description === 'string' ? { description: node.description } : {}),
    ...inner,
    type: [other.type, 'null'],
    ...(Array.isArray(inner.enum) ? { enum: [...inner.enum, null] } : {}),
  };
}

/**
 * Strict-mode JSON Schema for open models (OpenAI-style `strict: true`): nullable via type
 * arrays, every object property required, `additionalProperties: false`, no `format`.
 * The source schemas stay as they are for Claude.
 */
export function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!isObj(node)) return node;
  const nullable = nullableToTypeArray(node);
  if (nullable) return nullable;
  const out: Obj = Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'format')
      .map(([key, value]) => {
        if (key === 'enum' || key === 'const' || key === 'required') return [key, value];
        if (key === 'properties' && isObj(value)) return [key, Object.fromEntries(Object.entries(value).map(([p, s]) => [p, toStrictSchema(s)]))];
        return [key, toStrictSchema(value)];
      }),
  );
  return out.type === 'object' && isObj(out.properties)
    ? { ...out, required: Object.keys(out.properties), additionalProperties: false }
    : out;
}

/** Body of POST /v1/chat. */
export function chatBody(req: ClaudeRequest, model: string): Obj {
  return {
    model,
    messages: toChatMessages(req.system, req.messages),
    response_format: { type: 'json_schema', json_schema: { name: 'output', schema: toStrictSchema(req.schema), strict: true } },
    max_completion_tokens: req.maxTokens,
    enable_thinking: req.effort !== 'low',
  };
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Model text → JSON text (like Tasks' readModelJson): drops <think> blocks and ``` fences,
 * unwraps a JSON string that contains JSON, and falls back to the outermost {...}.
 * Returns the best effort; the caller's parser decides whether it is usable.
 */
export function cleanModelJson(raw: string): string {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (parses(text)) {
    const value: unknown = JSON.parse(text);
    return typeof value === 'string' && parses(value.trim()) ? value.trim() : text;
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const inner = start >= 0 && end > start ? text.slice(start, end + 1) : '';
  return inner && parses(inner) ? inner : text;
}

/** Worker HTTP error → Spanish CoachAiError (same codes the Claude adapter uses). */
export function workersError(status: number, body: unknown): CoachAiError {
  const code = isObj(body) && typeof body.error === 'string' ? body.error : '';
  if (status === 503 && code === 'quota') return new CoachAiError('quota', QUOTA_MESSAGE);
  if (status === 429) return new CoachAiError('rate_limited', 'La IA está saturada ahora mismo. Inténtalo en unos minutos.');
  if (status === 401 || status === 403 || status === 500) return new CoachAiError('auth', 'La IA no está bien configurada en el servidor.');
  if (status === 400 || status === 413) return new CoachAiError('api', 'La IA no ha podido procesar la petición. Inténtalo con algo más corto.');
  return new CoachAiError('overloaded', 'La IA no está disponible ahora mismo. Inténtalo en unos minutos.');
}

const tokens = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

function toResponse(data: unknown, fallbackModel: string): ClaudeResponse {
  if (!isObj(data) || typeof data.text !== 'string') throw new CoachAiError('api', 'La IA ha devuelto una respuesta no válida.');
  const usage = isObj(data.usage) ? data.usage : {};
  return {
    text: cleanModelJson(data.text),
    stopReason: data.finishReason === 'max_tokens' ? 'max_tokens' : 'end_turn',
    model: typeof data.model === 'string' && data.model ? data.model : fallbackModel,
    inputTokens: tokens(usage.inputTokens),
    outputTokens: tokens(usage.outputTokens),
    fallbackUsed: false,
  };
}

function mapFailure(error: unknown, signal: AbortSignal | undefined): CoachAiError {
  if (signal?.aborted || isAbortLike(error)) return timeoutError();
  if (error instanceof CoachAiError) return error;
  return new CoachAiError('network', 'No hemos podido conectar con la IA. Revisa tu conexión e inténtalo de nuevo.');
}

/** Header the worker rate-limits by: an opaque per-user key (never the raw user id). */
export const CLIENT_HEADER = 'x-ai-client';

const toHex = (buffer: ArrayBuffer): string => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

/** hex(HMAC-SHA256(secret, userId)): stable per user, unlinkable to the id without the secret. */
export async function clientKey(secret: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(userId)));
}

export function createWorkersAiPort(config: WorkersAiConfig): ClaudePort {
  const endpoint = `${config.url.replace(/\/+$/, '')}/v1/chat`;
  return {
    async generate(req: ClaudeRequest): Promise<ClaudeResponse> {
      try {
        const client: Record<string, string> = req.userId ? { [CLIENT_HEADER]: await clientKey(config.secret, req.userId) } : {};
        const res = await config.fetch(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.secret}`, 'content-type': 'application/json', ...client },
          body: JSON.stringify(chatBody(req, config.model)),
          signal: req.signal,
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) throw workersError(res.status, data);
        return toResponse(data, config.model);
      } catch (error) {
        throw mapFailure(error, req.signal);
      }
    },
  };
}
