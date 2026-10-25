/**
 * HTTP layer of the personal-URL MCP server (`POST /mcp/u/<secret>`):
 * method + Origin checks, rate limiting + secret → user resolution (token-gate.ts), bounded
 * body parsing, then JSON-RPC dispatch. Responses are always JSON (or 202).
 */
import { sha256Hex } from '../crypto.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { dispatchMessage } from './dispatch.ts';
import { extractMcpSecret, isAllowedOrigin } from './guards.ts';
import { authorizeToken, clientKeyOf } from './token-gate.ts';
import type { RateLimiter } from './token-gate.ts';
import { RPC, rpcError } from './protocol.ts';
import type { RpcReply } from './protocol.ts';
import type { ToolContext, ToolRegistry } from './tool.ts';
import type { UUID } from '../types.ts';

const MAX_BODY_BYTES = 1024 * 1024;

const MCP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-protocol-version',
};

export interface McpEndpointDeps {
  /** sha256(secret) → user id via svc_resolve_token(…, 'mcp'); null when unknown/revoked. */
  resolveUserId: (tokenHash: string) => Promise<UUID | null>;
  toolContext: (userId: UUID) => ToolContext;
  tools: ToolRegistry;
  instructions: string;
  rateLimiter: RateLimiter;
  logger: Logger;
  now: () => Date;
}

function toResponse(reply: RpcReply, extra: Record<string, string> = {}): Response {
  if (reply.body === null) return new Response(null, { status: reply.status, headers: { ...MCP_CORS, ...extra } });
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'Content-Type': 'application/json', ...MCP_CORS, ...extra },
  });
}

function parseBody(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

async function authorize(req: Request, deps: McpEndpointDeps): Promise<{ userId: UUID } | Response> {
  const secret = extractMcpSecret(new URL(req.url).pathname);
  if (!secret) {
    return toResponse(rpcError(404, null, RPC.INVALID_REQUEST, 'URL de conector no válida. Copia la URL completa desde la app (Yo › Conecta tu Claude).'));
  }
  const tokenHash = await sha256Hex(secret);
  const auth = await authorizeToken(deps.rateLimiter, deps.resolveUserId, { tokenHash, clientKey: clientKeyOf(req.headers), nowMs: deps.now().getTime() });
  if (auth.ok) return { userId: auth.userId };
  if (auth.reason === 'rate_limited') {
    return toResponse(rpcError(429, null, RPC.INTERNAL_ERROR, 'Demasiadas peticiones. Espera un minuto y vuelve a intentarlo.'), {
      'Retry-After': String(auth.retryAfterSec),
    });
  }
  return toResponse(rpcError(403, null, RPC.INVALID_REQUEST, 'Esta URL de conector está revocada o no existe. Genera una nueva en la app (Yo › Conecta tu Claude) y actualiza el conector en Claude.'));
}

export async function handleMcpHttp(req: Request, deps: McpEndpointDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: MCP_CORS });
  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...MCP_CORS, Allow: 'POST' } });
  }
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    deps.logger.warn('mcp origin rejected', { origin });
    return toResponse(rpcError(403, null, RPC.INVALID_REQUEST, 'Forbidden origin'));
  }
  try {
    const auth = await authorize(req, deps);
    if (auth instanceof Response) return auth;
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return toResponse(rpcError(413, null, RPC.INVALID_REQUEST, 'Mensaje demasiado grande'));
    }
    const parsed = parseBody(text);
    if (!parsed.ok) return toResponse(rpcError(400, null, RPC.PARSE_ERROR, 'Parse error: JSON inválido'));
    let ctx: ToolContext | null = null;
    const reply = await dispatchMessage(parsed.value, req.headers, {
      tools: deps.tools,
      instructions: deps.instructions,
      toolContext: () => (ctx ??= deps.toolContext(auth.userId)),
      logger: deps.logger,
    });
    return toResponse(reply);
  } catch (error) {
    deps.logger.error('mcp request failed', errorInfo(error));
    return toResponse(rpcError(500, null, RPC.INTERNAL_ERROR, 'Error interno del servidor MCP. Inténtalo de nuevo.'));
  }
}
