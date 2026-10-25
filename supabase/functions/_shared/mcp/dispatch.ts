/**
 * JSON-RPC dispatch for one already-parsed MCP message. Stateless: every
 * request is answered on its own (no Mcp-Session-Id is issued).
 */
import type { Logger } from '../log.ts';
import {
  accepted,
  decodeHeaderValue,
  DEFAULT_LEGACY_VERSION,
  detectEra,
  isRecord,
  isRpcId,
  LEGACY_VERSIONS,
  META_SERVER_INFO,
  MODERN_VERSIONS,
  negotiateLegacyVersion,
  RPC,
  rpcError,
  rpcResult,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
} from './protocol.ts';
import type { Era, JsonRpcId, RpcReply } from './protocol.ts';
import { toolListEntry } from './tool.ts';
import type { ToolContext, ToolRegistry } from './tool.ts';

export interface DispatchDeps {
  tools: ToolRegistry;
  instructions: string;
  /** Lazily builds the tool context (only tools/call needs the database). */
  toolContext: () => ToolContext;
  logger: Logger;
}

const CAPABILITIES = { tools: { listChanged: false } } as const;
const TOOLS_TTL_MS = 5 * 60_000;
const DISCOVER_TTL_MS = 60 * 60_000;

function modernResult(id: JsonRpcId, result: Record<string, unknown>): RpcReply {
  return rpcResult(id, {
    resultType: 'complete',
    ...result,
    _meta: { [META_SERVER_INFO]: { name: SERVER_INFO.name, version: SERVER_INFO.version } },
  });
}

function headerMismatch(id: JsonRpcId, detail: string): RpcReply {
  return rpcError(400, id, RPC.HEADER_MISMATCH, `Header mismatch: ${detail}`);
}

/** Modern-era header ↔ body validation (Streamable HTTP 2026-07-28 §Server Validation). */
function validateModernHeaders(
  id: JsonRpcId,
  version: string,
  method: string,
  params: Record<string, unknown> | undefined,
  headers: Headers,
): RpcReply | null {
  const headerVersion = headers.get('mcp-protocol-version');
  if (headerVersion === null) return headerMismatch(id, 'falta la cabecera MCP-Protocol-Version');
  if (headerVersion !== version) return headerMismatch(id, `MCP-Protocol-Version '${headerVersion}' ≠ '${version}'`);
  const headerMethod = headers.get('mcp-method');
  if (headerMethod === null) return headerMismatch(id, 'falta la cabecera Mcp-Method');
  if (headerMethod !== method) return headerMismatch(id, `Mcp-Method '${headerMethod}' ≠ '${method}'`);
  if (method === 'tools/call') {
    const rawName = headers.get('mcp-name');
    if (rawName === null) return headerMismatch(id, 'falta la cabecera Mcp-Name');
    const name = decodeHeaderValue(rawName);
    if (name !== params?.name) return headerMismatch(id, `Mcp-Name '${name ?? ''}' ≠ '${String(params?.name)}'`);
  }
  return null;
}

async function callTool(id: JsonRpcId, era: Era, params: Record<string, unknown> | undefined, deps: DispatchDeps): Promise<RpcReply> {
  const name = params?.name;
  if (typeof name !== 'string') return rpcError(200, id, RPC.INVALID_PARAMS, 'tools/call requiere params.name');
  const args = params?.arguments;
  if (args !== undefined && !isRecord(args)) return rpcError(200, id, RPC.INVALID_PARAMS, 'params.arguments debe ser un objeto');
  const tool = deps.tools.get(name);
  if (!tool) {
    const known = deps.tools.list().map((t) => t.name).join(', ');
    return rpcError(200, id, RPC.INVALID_PARAMS, `Herramienta desconocida: ${name}. Disponibles: ${known}`);
  }
  const started = Date.now();
  const result = await tool.run(args ?? {}, deps.toolContext());
  deps.logger.info('mcp tool call', { tool: name, era, isError: result.isError === true, ms: Date.now() - started });
  const payload = { ...result } as Record<string, unknown>;
  return era === 'modern' ? modernResult(id, payload) : rpcResult(id, payload);
}

function initializeResult(id: JsonRpcId, params: Record<string, unknown> | undefined, deps: DispatchDeps): RpcReply {
  const protocolVersion = negotiateLegacyVersion(params?.protocolVersion);
  deps.logger.info('mcp initialize', { requested: String(params?.protocolVersion ?? ''), negotiated: protocolVersion });
  return rpcResult(id, { protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: deps.instructions });
}

function handleModern(
  id: JsonRpcId,
  version: string,
  method: string,
  params: Record<string, unknown> | undefined,
  headers: Headers,
  deps: DispatchDeps,
): RpcReply | Promise<RpcReply> {
  if (!(MODERN_VERSIONS as readonly string[]).includes(version)) {
    return rpcError(400, id, RPC.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: [...SUPPORTED_VERSIONS],
      requested: version,
    });
  }
  const mismatch = validateModernHeaders(id, version, method, params, headers);
  if (mismatch) return mismatch;
  switch (method) {
    case 'server/discover':
      return modernResult(id, {
        supportedVersions: [...SUPPORTED_VERSIONS],
        capabilities: CAPABILITIES,
        instructions: deps.instructions,
        ttlMs: DISCOVER_TTL_MS,
        cacheScope: 'public',
      });
    case 'tools/list':
      return modernResult(id, { tools: deps.tools.list().map(toolListEntry), ttlMs: TOOLS_TTL_MS, cacheScope: 'private' });
    case 'tools/call':
      return callTool(id, 'modern', params, deps);
    default:
      return rpcError(404, id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

function handleLegacy(
  id: JsonRpcId,
  version: string | null,
  method: string,
  params: Record<string, unknown> | undefined,
  deps: DispatchDeps,
): RpcReply | Promise<RpcReply> {
  if (method === 'initialize') return initializeResult(id, params, deps);
  const effective = version ?? DEFAULT_LEGACY_VERSION;
  if (!(LEGACY_VERSIONS as readonly string[]).includes(effective)) {
    return rpcError(400, id, RPC.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: [...SUPPORTED_VERSIONS],
      requested: effective,
    });
  }
  switch (method) {
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: deps.tools.list().map(toolListEntry) });
    case 'tools/call':
      return callTool(id, 'legacy', params, deps);
    default:
      return rpcError(200, id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/** Handles one JSON-RPC message (already JSON-parsed). */
export async function dispatchMessage(message: unknown, headers: Headers, deps: DispatchDeps): Promise<RpcReply> {
  if (Array.isArray(message)) return rpcError(400, null, RPC.INVALID_REQUEST, 'JSON-RPC batch no soportado');
  if (!isRecord(message) || message.jsonrpc !== '2.0') {
    return rpcError(400, null, RPC.INVALID_REQUEST, 'Se esperaba un mensaje JSON-RPC 2.0');
  }
  const { method } = message;
  if (typeof method !== 'string') {
    // A JSON-RPC response (client answering us): nothing to do.
    return 'result' in message || 'error' in message ? accepted() : rpcError(400, null, RPC.INVALID_REQUEST, 'Falta method');
  }
  if (!('id' in message)) return accepted(); // notification (e.g. notifications/initialized)
  const { id } = message;
  if (!isRpcId(id)) return rpcError(400, null, RPC.INVALID_REQUEST, 'id inválido');
  const params = isRecord(message.params) ? message.params : undefined;
  if (message.params !== undefined && !params) return rpcError(400, id, RPC.INVALID_REQUEST, 'params debe ser un objeto');
  const { era, version } = detectEra(method, params, headers);
  return era === 'modern' && version
    ? await handleModern(id, version, method, params, headers, deps)
    : await handleLegacy(id, version, method, params, deps);
}
