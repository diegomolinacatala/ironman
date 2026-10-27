/**
 * POST /v1/chat: configuration check (secret ≥ 32 chars and both limiters, else 500 — fails
 * closed) → per-IP limit (before auth, so 401 floods are throttled) → bearer secret (constant
 * time) → per-user limit (`x-ai-client`) → body ≤ 3 MB → validation → env.AI.run →
 * `{ text, finishReason, usage, model }`.
 * Errors `{ error, message }`: 401 unauthorized, 400 bad_request, 404, 405, 413 too_large,
 * 429 rate_limited, 503 quota (free daily neurons used up), 502 model_error, 500 misconfigured.
 * Never logs or echoes the secret or the request body.
 */
import {
  bearer,
  clientKey,
  ipKey,
  isQuotaError,
  MAX_BODY_BYTES,
  MIN_SECRET_LENGTH,
  modelInput,
  normalizeOutput,
  parseChatRequest,
  secretMatches,
} from './chat.mts';
import type { AiBinding, RateLimitBinding } from './types.mts';

export interface HandlerDeps {
  ai: AiBinding;
  /** Per caller IP, before auth. Required. */
  ipLimiter: RateLimitBinding | null;
  /** Per app user (`x-ai-client`). Required. */
  chatLimiter: RateLimitBinding | null;
  secret: string | undefined;
  /** Structured log line (console in production, silent in tests). */
  log: (level: 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const error = (status: number, code: string, message: string, headers: Record<string, string> = {}): Response => json({ error: code, message }, status, headers);

class TooLarge extends Error {}

async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) throw new TooLarge();
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new TooLarge();
  return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
}

interface Ready {
  ai: AiBinding;
  ipLimiter: RateLimitBinding;
  chatLimiter: RateLimitBinding;
  secret: string;
  log: HandlerDeps['log'];
}

const tooMany = (): Response => error(429, 'rate_limited', 'Too many requests. Try again in a minute.', { 'retry-after': '60' });

async function run(req: Request, deps: Ready): Promise<Response> {
  if (!(await deps.ipLimiter.limit({ key: ipKey(req.headers.get('cf-connecting-ip')) })).success) return tooMany();
  if (!(await secretMatches(bearer(req.headers.get('authorization')), deps.secret))) {
    return error(401, 'unauthorized', 'Missing or invalid bearer token.');
  }
  if (!(await deps.chatLimiter.limit({ key: clientKey(req.headers.get('x-ai-client')) })).success) return tooMany();
  let body: unknown;
  try {
    body = await readBody(req);
  } catch (e) {
    return e instanceof TooLarge ? error(413, 'too_large', `Body above ${MAX_BODY_BYTES} bytes.`) : error(400, 'bad_request', 'Body is not valid JSON.');
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return error(400, 'bad_request', parsed.error);
  const { model } = parsed.value;
  try {
    const output = await deps.ai.run(model, modelInput(parsed.value));
    return json(normalizeOutput(output, model));
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : 'unknown';
    if (isQuotaError(e)) {
      deps.log('warn', 'workers ai quota exhausted', { model });
      return error(503, 'quota', 'The free daily Workers AI allocation is used up. Try again tomorrow.');
    }
    deps.log('error', 'workers ai failed', { model, message });
    return error(502, 'model_error', 'The model failed to answer.');
  }
}

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname !== '/v1/chat') return error(404, 'not_found', 'Only POST /v1/chat.');
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Use POST.', { allow: 'POST' });
  const { ai, ipLimiter, chatLimiter, secret, log } = deps;
  if (!secret || secret.length < MIN_SECRET_LENGTH || !ipLimiter || !chatLimiter) {
    log('error', 'worker misconfigured', {
      secret: !secret ? 'missing' : secret.length < MIN_SECRET_LENGTH ? 'too short' : 'ok',
      ipLimiter: Boolean(ipLimiter),
      chatLimiter: Boolean(chatLimiter),
    });
    return error(500, 'misconfigured', 'The worker is not configured.');
  }
  return run(req, { ai, ipLimiter, chatLimiter, secret, log });
}
