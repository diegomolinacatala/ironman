/**
 * Pure helpers of POST /v1/chat: request validation (model allowlist, OpenAI-style messages
 * with text and base64 image parts, strict json_schema), the Workers AI input for each model
 * family, the normalised answer `{ text, finishReason, usage, model }` and the detection of
 * the "daily free allocation used up" error.
 */
import type { Result } from './types.mts';

/** Only models of the Workers Free plan (GLM-5.3 and DeepSeek V4.1 answer 5035 "not available"). */
export const MODELS = [
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
] as const;
export type Model = (typeof MODELS)[number];

export const MAX_BODY_BYTES = 3 * 1024 * 1024;
export const MAX_MESSAGES = 40;
export const MAX_PARTS = 20;
export const MAX_COMPLETION_TOKENS = 32_768;
/** Shorter AI_SHARED_SECRET values are treated as a misconfiguration. */
export const MIN_SECRET_LENGTH = 32;
/** Rate-limit bucket for requests without a valid `x-ai-client` key. */
export const SHARED_CLIENT_KEY = 'shared';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface JsonSchemaFormat {
  type: 'json_schema';
  json_schema: { name: string; schema: Obj; strict?: boolean };
}

export interface ChatRequest {
  model: Model;
  messages: ChatMessage[];
  response_format?: JsonSchemaFormat;
  max_completion_tokens?: number;
  enable_thinking: boolean;
  temperature?: number;
}

export interface ChatResult {
  text: string;
  /** 'stop' | 'max_tokens' | whatever else the model reports. */
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

/** Only inline images: the worker never makes the model fetch a URL. */
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function parsePart(raw: unknown, path: string): Result<ContentPart> {
  if (!isObj(raw)) return fail(`${path}: must be an object`);
  if (raw.type === 'text' && typeof raw.text === 'string') return { ok: true, value: { type: 'text', text: raw.text } };
  if (raw.type === 'image_url' && isObj(raw.image_url) && typeof raw.image_url.url === 'string') {
    return DATA_IMAGE.test(raw.image_url.url)
      ? { ok: true, value: { type: 'image_url', image_url: { url: raw.image_url.url } } }
      : fail(`${path}.image_url.url: only data:image/(jpeg|png|webp);base64 URLs`);
  }
  return fail(`${path}: expected a text or image_url part`);
}

function parseMessage(raw: unknown, path: string): Result<ChatMessage> {
  if (!isObj(raw)) return fail(`${path}: must be an object`);
  const role = raw.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant') return fail(`${path}.role: system, user or assistant`);
  if (typeof raw.content === 'string') return { ok: true, value: { role, content: raw.content } };
  if (!Array.isArray(raw.content) || raw.content.length === 0 || raw.content.length > MAX_PARTS) {
    return fail(`${path}.content: a string or 1-${MAX_PARTS} parts`);
  }
  const parts: ContentPart[] = [];
  for (let i = 0; i < raw.content.length; i += 1) {
    const part = parsePart(raw.content[i], `${path}.content[${i}]`);
    if (!part.ok) return part;
    if (part.value.type === 'image_url' && role !== 'user') return fail(`${path}: images only in user messages`);
    parts.push(part.value);
  }
  return { ok: true, value: { role, content: parts } };
}

function parseFormat(raw: unknown): Result<JsonSchemaFormat | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isObj(raw) || raw.type !== 'json_schema' || !isObj(raw.json_schema)) return fail('response_format: { type: "json_schema", json_schema: { name, schema, strict? } }');
  const { name, schema, strict } = raw.json_schema;
  if (typeof name !== 'string' || !SCHEMA_NAME.test(name)) return fail('response_format.json_schema.name: 1-64 letters, digits, - or _');
  if (!isObj(schema)) return fail('response_format.json_schema.schema: must be an object');
  if (strict !== undefined && typeof strict !== 'boolean') return fail('response_format.json_schema.strict: boolean');
  return { ok: true, value: { type: 'json_schema', json_schema: { name, schema, ...(strict !== undefined ? { strict } : {}) } } };
}

function optionalNumber(v: unknown, name: string, min: number, max: number, integer: boolean): Result<number | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    return fail(`${name}: ${integer ? 'integer' : 'number'} between ${min} and ${max}`);
  }
  return { ok: true, value: v };
}

/** Validates the body of POST /v1/chat (unknown top-level keys are ignored). */
export function parseChatRequest(body: unknown): Result<ChatRequest> {
  if (!isObj(body)) return fail('body: must be a JSON object');
  if (typeof body.model !== 'string' || !(MODELS as readonly string[]).includes(body.model)) {
    return fail(`model: one of ${MODELS.join(', ')}`);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return fail(`messages: 1-${MAX_MESSAGES} messages`);
  }
  const messages: ChatMessage[] = [];
  for (let i = 0; i < body.messages.length; i += 1) {
    const m = parseMessage(body.messages[i], `messages[${i}]`);
    if (!m.ok) return m;
    messages.push(m.value);
  }
  const format = parseFormat(body.response_format);
  if (!format.ok) return format;
  const maxTokens = optionalNumber(body.max_completion_tokens, 'max_completion_tokens', 1, MAX_COMPLETION_TOKENS, true);
  if (!maxTokens.ok) return maxTokens;
  const temperature = optionalNumber(body.temperature, 'temperature', 0, 2, false);
  if (!temperature.ok) return temperature;
  if (body.enable_thinking !== undefined && typeof body.enable_thinking !== 'boolean') return fail('enable_thinking: boolean');
  return {
    ok: true,
    value: {
      model: body.model as Model,
      messages,
      ...(format.value ? { response_format: format.value } : {}),
      ...(maxTokens.value !== undefined ? { max_completion_tokens: maxTokens.value } : {}),
      enable_thinking: body.enable_thinking === true,
      ...(temperature.value !== undefined ? { temperature: temperature.value } : {}),
    },
  };
}

/**
 * `env.AI.run` input. Llama models take Workers AI's own shape (`json_schema` is the schema
 * itself, `max_tokens`); the rest take the OpenAI shape plus `chat_template_kwargs`.
 */
export function modelInput(req: ChatRequest): Record<string, unknown> {
  const base = { messages: req.messages, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) };
  if (req.model.startsWith('@cf/meta/')) {
    return {
      ...base,
      ...(req.response_format ? { response_format: { type: 'json_schema', json_schema: req.response_format.json_schema.schema } } : {}),
      ...(req.max_completion_tokens !== undefined ? { max_tokens: req.max_completion_tokens } : {}),
    };
  }
  return {
    ...base,
    ...(req.response_format ? { response_format: req.response_format } : {}),
    ...(req.max_completion_tokens !== undefined ? { max_completion_tokens: req.max_completion_tokens } : {}),
    chat_template_kwargs: { enable_thinking: req.enable_thinking },
  };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  if (Array.isArray(content)) {
    return content.map((p) => (isObj(p) && typeof p.text === 'string' ? p.text : '')).join('');
  }
  // Some models return the JSON already parsed.
  return JSON.stringify(content);
}

const count = (...values: unknown[]): number => {
  const n = values.find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return typeof n === 'number' ? Math.round(n) : 0;
};

/** Workers AI output (OpenAI `choices[0].message.content` or legacy `response`) → ChatResult. */
export function normalizeOutput(output: unknown, model: string): ChatResult {
  const o = isObj(output) ? output : {};
  const choice = Array.isArray(o.choices) && isObj(o.choices[0]) ? o.choices[0] : {};
  const message = isObj(choice.message) ? choice.message : {};
  const content = o.response !== undefined && o.response !== null ? o.response : message.content;
  const rawFinish = typeof choice.finish_reason === 'string' ? choice.finish_reason : typeof o.finish_reason === 'string' ? o.finish_reason : 'stop';
  const usage = isObj(o.usage) ? o.usage : {};
  return {
    text: textOf(content),
    finishReason: rawFinish === 'length' ? 'max_tokens' : rawFinish,
    usage: { inputTokens: count(usage.prompt_tokens, usage.input_tokens), outputTokens: count(usage.completion_tokens, usage.output_tokens) },
    model,
  };
}

/** Workers AI error once the account's free daily neurons are used up (3036 / 4006 / message). */
export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = isObj(error) ? error.code : undefined;
  return code === 3036 || code === 4006 || /\b(3036|4006)\b|daily free allocation|neurons/i.test(message);
}

/** Constant-time comparison of the bearer token (SHA-256 of both, so lengths never leak). */
export async function secretMatches(given: string | null, expected: string): Promise<boolean> {
  if (!given || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function bearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim());
  return match ? match[1] : null;
}

/** Per-user rate-limit key: the 64-hex `x-ai-client` header, or the shared bucket. */
export function clientKey(header: string | null): string {
  const value = (header ?? '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(value) ? `client:${value}` : SHARED_CLIENT_KEY;
}

/** Per-IP key (Cloudflare sets cf-connecting-ip on every request). */
export function ipKey(header: string | null): string {
  const value = (header ?? '').trim();
  return value && value.length <= 64 ? `ip:${value}` : 'ip:unknown';
}
