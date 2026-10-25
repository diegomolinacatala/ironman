import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex } from '../crypto.ts';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import { handleMcpHttp } from './endpoint.ts';
import type { McpEndpointDeps } from './endpoint.ts';
import { createRateLimiter } from './token-gate.ts';
import { MCP_INSTRUCTIONS } from './instructions.ts';
import { createRebufoRegistry } from './tools/index.ts';

const SECRET = `rb_${'0123456789abcdef'.repeat(4)}`;
const URL_OK = `https://ref.supabase.co/functions/v1/mcp/u/${SECRET}`;

async function deps(overrides: Partial<McpEndpointDeps> = {}): Promise<McpEndpointDeps> {
  const validHash = await sha256Hex(SECRET);
  const store = fakeStore(emptyState());
  return {
    resolveUserId: async (hash) => (hash === validHash ? USER : null),
    toolContext: (userId) => ({ userId, store, now: fixedNow, logger: silentLogger }),
    tools: createRebufoRegistry(),
    instructions: MCP_INSTRUCTIONS,
    rateLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    logger: silentLogger,
    now: fixedNow,
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}, url = URL_OK): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(req: Request, d?: McpEndpointDeps): Promise<{ status: number; body: Record<string, unknown> | null; headers: Headers }> {
  const res = await handleMcpHttp(req, d ?? (await deps()));
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, headers: res.headers };
}

const result = (r: { body: Record<string, unknown> | null }): Record<string, unknown> => r.body?.result as Record<string, unknown>;
const error = (r: { body: Record<string, unknown> | null }): Record<string, unknown> => r.body?.error as Record<string, unknown>;

test('legacy initialize echoes a supported version and negotiates down otherwise', async () => {
  for (const [requested, expected] of [
    ['2025-06-18', '2025-06-18'],
    ['2025-03-26', '2025-03-26'],
    ['2024-11-05', '2025-11-25'],
    ['2026-07-28', '2025-11-25'],
  ]) {
    const r = await call(post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: requested, capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } }));
    assert.equal(r.status, 200);
    assert.equal(result(r).protocolVersion, expected);
    assert.deepEqual(result(r).capabilities, { tools: { listChanged: false } });
    assert.equal((result(r).serverInfo as { name: string }).name, 'rebufo');
    assert.equal(typeof result(r).instructions, 'string');
    assert.equal(r.headers.get('mcp-session-id'), null, 'stateless: no session id');
  }
});

test('notifications and client responses get 202 with no body', async () => {
  const n = await call(post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(n.status, 202);
  assert.equal(n.body, null);
  const resp = await call(post({ jsonrpc: '2.0', id: 9, result: {} }));
  assert.equal(resp.status, 202);
});

test('GET and DELETE are 405 with Allow: POST; OPTIONS is a CORS preflight', async () => {
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const res = await handleMcpHttp(new Request(URL_OK, { method }), await deps());
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  }
  const pre = await handleMcpHttp(new Request(URL_OK, { method: 'OPTIONS' }), await deps());
  assert.equal(pre.status, 204);
});

test('legacy ping, tools/list (8 tools, stable order) and unknown method', async () => {
  const ping = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '2025-11-25' }));
  assert.deepEqual(ping.body, { jsonrpc: '2.0', id: 1, result: {} });
  const list = await call(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
  const tools = result(list).tools as { name: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[];
  assert.deepEqual(tools.map((t) => t.name), [
    'get_planning_context',
    'get_friends_availability',
    'propose_plan_changes',
    'log_life_event',
    'log_daily_metrics',
    'log_completed_activity',
    'get_plan_for_device',
    'manage_race',
  ]);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(typeof t.annotations.title, 'string');
    assert.equal(t.annotations.openWorldHint, false);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof t.annotations.destructiveHint, 'boolean');
  }
  assert.equal(result(list).ttlMs, undefined, 'legacy results carry no modern fields');
  const unknown = await call(post({ jsonrpc: '2.0', id: 3, method: 'resources/list' }));
  assert.equal(unknown.status, 200);
  assert.equal(error(unknown).code, -32601);
});

test('tools/call: unknown tool is -32602; validation errors are isError results', async () => {
  const unknown = await call(post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } }));
  assert.equal(error(unknown).code, -32602);
  const invalid = await call(post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_planning_context', arguments: { week_start: 'lunes' } } }));
  assert.equal(result(invalid).isError, true);
  const text = (result(invalid).content as { text: string }[])[0].text;
  assert.match(text, /week_start/);
  const ok = await call(post({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_planning_context', arguments: { week_start: '2026-10-26' } } }));
  assert.equal(result(ok).isError, undefined);
  const sc = result(ok).structuredContent as { weekStart: string };
  assert.equal(sc.weekStart, '2026-10-26');
  const asText = JSON.parse((result(ok).content as { text: string }[])[0].text) as { weekStart: string };
  assert.equal(asText.weekStart, '2026-10-26', 'text block mirrors structuredContent');
});

const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'claude-ai', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const modernHeaders = (method: string, name?: string): Record<string, string> => ({
  'mcp-protocol-version': '2026-07-28',
  'mcp-method': method,
  ...(name ? { 'mcp-name': name } : {}),
});

test('modern era: server/discover, tools/list with ttl/cacheScope, tools/call with resultType', async () => {
  const discover = await call(post({ jsonrpc: '2.0', id: 'd1', method: 'server/discover', params: { _meta: modernMeta } }, modernHeaders('server/discover')));
  assert.equal(discover.status, 200);
  assert.equal(result(discover).resultType, 'complete');
  assert.deepEqual(result(discover).supportedVersions, ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']);
  assert.equal(result(discover).cacheScope, 'public');
  assert.ok((result(discover)._meta as Record<string, unknown>)['io.modelcontextprotocol/serverInfo']);
  const list = await call(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta } }, modernHeaders('tools/list')));
  assert.equal(result(list).resultType, 'complete');
  assert.equal(result(list).ttlMs, 300000);
  assert.equal(result(list).cacheScope, 'private');
  const encodedName = `=?base64?${btoa('get_plan_for_device')}?=`;
  const callRes = await call(
    post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_plan_for_device', arguments: {}, _meta: modernMeta } }, modernHeaders('tools/call', encodedName)),
  );
  assert.equal(callRes.status, 200);
  assert.equal(result(callRes).resultType, 'complete');
});

test('modern era: header mismatch, missing headers, unsupported version, unknown method', async () => {
  const mismatch = await call(
    post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'manage_race', arguments: {}, _meta: modernMeta } }, modernHeaders('tools/call', 'get_planning_context')),
  );
  assert.equal(mismatch.status, 400);
  assert.equal(error(mismatch).code, -32020);
  const missing = await call(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta } }, { 'mcp-protocol-version': '2026-07-28' }));
  assert.equal(missing.status, 400);
  assert.equal(error(missing).code, -32020);
  const future = { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' };
  const unsupported = await call(post({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: future } }, { ...modernHeaders('tools/list'), 'mcp-protocol-version': '2099-01-01' }));
  assert.equal(unsupported.status, 400);
  assert.equal(error(unsupported).code, -32022);
  assert.ok(((error(unsupported).data as { supported: string[] }).supported).includes('2026-07-28'));
  const ping = await call(post({ jsonrpc: '2.0', id: 4, method: 'ping', params: { _meta: modernMeta } }, modernHeaders('ping')));
  assert.equal(ping.status, 404);
  assert.equal(error(ping).code, -32601);
});

test('legacy header with an unknown version is rejected with 400', async () => {
  const r = await call(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' }));
  assert.equal(r.status, 400);
});

test('origin, path, token, body and batch guards', async () => {
  const badOrigin = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' }));
  assert.equal(badOrigin.status, 403);
  const claudeOrigin = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://claude.ai' }));
  assert.equal(claudeOrigin.status, 200);
  const badPath = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, 'https://ref.supabase.co/functions/v1/mcp'));
  assert.equal(badPath.status, 404);
  const revoked = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, `https://ref.supabase.co/mcp/u/rb_${'f'.repeat(64)}`));
  assert.equal(revoked.status, 403);
  const parse = await call(post('{not json'));
  assert.equal(parse.status, 400);
  assert.equal(error(parse).code, -32700);
  const batch = await call(post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]));
  assert.equal(batch.status, 400);
  const notRpc = await call(post({ hello: 'world' }));
  assert.equal(error(notRpc).code, -32600);
  const shortPath = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, `https://ref.supabase.co/mcp/u/${SECRET}/`));
  assert.equal(shortPath.status, 200, 'trailing slash tolerated');
});

test('per-token rate limit answers 429 with Retry-After', async () => {
  const d = await deps({ rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }) });
  await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), d);
  await call(post({ jsonrpc: '2.0', id: 2, method: 'ping' }), d);
  const limited = await call(post({ jsonrpc: '2.0', id: 3, method: 'ping' }), d);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('a flood of unknown tokens does not lock out a valid connector (global cap counts resolved tokens only)', async () => {
  const d = await deps({ rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000, globalLimit: 3, failureLimit: 1000 }) });
  for (let i = 0; i < 30; i += 1) {
    const bogus = `https://ref.supabase.co/functions/v1/mcp/u/rb_${String(i).padStart(64, '0')}`;
    assert.equal((await call(post({ jsonrpc: '2.0', id: i, method: 'ping' }, { 'x-forwarded-for': '203.0.113.9' }, bogus), d)).status, 403);
  }
  assert.equal((await call(post({ jsonrpc: '2.0', id: 99, method: 'ping' }), d)).status, 200);
});
