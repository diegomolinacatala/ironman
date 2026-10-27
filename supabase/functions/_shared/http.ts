/**
 * HTTP helpers shared by every function: CORS for app calls (web preview),
 * the JSON error envelope `{ error, message }` and bounded body reading.
 * Uses only Web standard APIs (Request/Response/Headers).
 */

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'too_large'
  | 'rate_limited'
  | 'consent_required'
  | 'ai_unavailable'
  | 'apple_not_configured'
  | 'not_connected'
  | 'invalid_key'
  | 'garmin_expired'
  | 'garmin_unavailable'
  | 'server_misconfigured'
  | 'internal';

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(
  status: number,
  error: ErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return json({ error, message }, status, extraHeaders);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

export function methodNotAllowed(allow: string): Response {
  return errorResponse(405, 'method_not_allowed', 'Método no permitido.', { Allow: allow });
}

export class BodyError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'BodyError';
    this.status = status;
    this.code = code;
  }
}

/** Reads the body as text, refusing payloads above `maxBytes`. */
export async function readText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new BodyError(413, 'payload_too_large', 'La petición es demasiado grande.');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new BodyError(413, 'payload_too_large', 'La petición es demasiado grande.');
  }
  return text;
}

/** Reads and parses a JSON body; empty body → `{}`. */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await readText(req, maxBytes);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError(400, 'bad_request', 'El cuerpo de la petición no es JSON válido.');
  }
}

/** Extracts the bearer token from an Authorization header. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

export function bodyErrorResponse(error: unknown): Response | null {
  return error instanceof BodyError ? errorResponse(error.status, error.code, error.message) : null;
}
