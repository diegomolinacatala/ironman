/**
 * Minimal client for the official COROS MCP server (https://mcp.coros.com/mcp, regional
 * resource such as https://mcpeu.coros.com/mcp). Verified against the real server: it is
 * stateless (no Mcp-Session-Id) and answers JSON-RPC over plain `application/json`, so a
 * `tools/call` is a single POST. SSE answers are still accepted in case that changes.
 *
 * The tools return prose reports (parsed in parse.ts), never fed to a language model here.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export class CorosApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CorosApiError';
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CorosMcp {
  /** Calls one tool and returns its text (a JSON-encoded string literal is unwrapped). */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

interface RpcResponse {
  result?: { content?: { type?: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  error?: { code?: number; message?: string };
}

/** Last JSON-RPC message of an SSE body (`data: {...}` lines). */
function fromEventStream(body: string): unknown {
  const events = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((data) => data.length > 0);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(events[i]);
    } catch {
      // keep looking
    }
  }
  return null;
}

/** COROS wraps some reports in a JSON string literal ("\"Sport Records…\""). */
export function unwrapText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('"')) return text;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'string' ? parsed : text;
  } catch {
    return text;
  }
}

export function toolText(message: unknown, tool: string): string {
  const rpc = (message ?? {}) as RpcResponse;
  if (rpc.error) throw new CorosApiError(502, `COROS respondió con un error en ${tool}: ${rpc.error.message ?? rpc.error.code ?? 'desconocido'}`);
  const result = rpc.result;
  if (!result) throw new CorosApiError(502, `COROS no devolvió resultado para ${tool}.`);
  const text = (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => unwrapText(c.text as string))
    .join('\n');
  if (result.isError) throw new CorosApiError(502, `La herramienta ${tool} de COROS falló: ${text.slice(0, 200)}`);
  if (!text && result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  return text;
}

export function createCorosMcp(opts: { resource: string; accessToken: string; fetch: FetchLike; timeoutMs?: number }): CorosMcp {
  let nextId = 1;
  return {
    async callTool(name, args) {
      const id = nextId++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
      let res: Response;
      try {
        res = await opts.fetch(opts.resource, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${opts.accessToken}`,
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': MCP_PROTOCOL_VERSION,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new CorosApiError(504, `COROS no respondió a tiempo (${name}): ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) throw new CorosApiError(res.status, 'COROS ha rechazado el acceso (token caducado o revocado).');
      if (!res.ok) throw new CorosApiError(res.status, `COROS respondió ${res.status} en ${name}.`);
      const body = await res.text();
      const type = res.headers.get('content-type') ?? '';
      let message: unknown;
      try {
        message = type.includes('text/event-stream') ? fromEventStream(body) : JSON.parse(body);
      } catch {
        throw new CorosApiError(502, `Respuesta de COROS no válida en ${name}.`);
      }
      return toolText(message, name);
    },
  };
}
