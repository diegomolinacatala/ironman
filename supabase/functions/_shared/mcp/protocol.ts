/**
 * MCP protocol constants and JSON-RPC helpers for a stateless, dual-era
 * Streamable HTTP server (docs/research/05 §A5):
 * - legacy era 2025-03-26 … 2025-11-25 (`initialize` handshake, no session id);
 * - modern era 2026-07-28 (per-request `_meta`, mirrored headers, server/discover).
 */

export const SERVER_INFO = { name: 'rebufo', title: 'Rebufo', version: '0.1.0' } as const;

export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
/** Version assumed when a legacy client omits MCP-Protocol-Version. */
export const DEFAULT_LEGACY_VERSION = '2025-03-26';

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

export type JsonRpcId = string | number;

export interface RpcReply {
  /** HTTP status. */
  status: number;
  /** JSON body, or null for 202/empty responses. */
  body: Record<string, unknown> | null;
}

export function rpcResult(id: JsonRpcId, result: Record<string, unknown>): RpcReply {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

export function rpcError(
  status: number,
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): RpcReply {
  const error = data ? { code, message, data } : { code, message };
  return { status, body: id === null ? { jsonrpc: '2.0', error } : { jsonrpc: '2.0', id, error } };
}

export const accepted = (): RpcReply => ({ status: 202, body: null });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/** Decodes the `=?base64?…?=` sentinel used by modern clients for header values. */
export function decodeHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
  if (!m) return value;
  try {
    const binary = atob(m[1]);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export type Era = 'legacy' | 'modern';

export interface EraInfo {
  era: Era;
  /** Version declared by the request (body `_meta` or header), if any. */
  version: string | null;
}

/** Era detection per research A5.2. */
export function detectEra(method: string, params: Record<string, unknown> | undefined, headers: Headers): EraInfo {
  if (method === 'initialize') return { era: 'legacy', version: null };
  const meta = isRecord(params?._meta) ? params?._meta : undefined;
  const metaVersion = meta && typeof meta[META_PROTOCOL_VERSION] === 'string' ? (meta[META_PROTOCOL_VERSION] as string) : null;
  const headerVersion = headers.get('mcp-protocol-version');
  if (metaVersion) return { era: 'modern', version: metaVersion };
  if (headerVersion && (MODERN_VERSIONS as readonly string[]).includes(headerVersion)) {
    return { era: 'modern', version: headerVersion };
  }
  return { era: 'legacy', version: headerVersion };
}

/** Legacy `initialize` negotiation: echo a supported version, else offer the latest legacy one. */
export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === 'string' && (LEGACY_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LEGACY_VERSIONS[0];
}
