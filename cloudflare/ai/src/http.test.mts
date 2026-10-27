import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BODY_BYTES } from './chat.mts';
import { handleRequest } from './http.mts';
import type { HandlerDeps } from './http.mts';

const SECRET = 'worker-shared-secret-0123456789abcdef';
const CLIENT = 'a'.repeat(64);

interface Fake {
  deps: HandlerDeps;
  calls: { model: string; input: Record<string, unknown> }[];
  logs: string[];
  ipKeys: string[];
  chatKeys: string[];
}

interface FakeOptions {
  output?: unknown;
  error?: Error;
  allowIp?: boolean;
  allowChat?: boolean;
  secret?: string | undefined;
  noIpLimiter?: boolean;
  noChatLimiter?: boolean;
}

function fake(opts: FakeOptions = {}): Fake {
  const calls: Fake['calls'] = [];
  const logs: string[] = [];
  const ipKeys: string[] = [];
  const chatKeys: string[] = [];
  return {
    calls,
    logs,
    ipKeys,
    chatKeys,
    deps: {
      ai: {
        run: async (model, input) => {
          calls.push({ model, input });
          if (opts.error) throw opts.error;
          return opts.output ?? { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
        },
      },
      ipLimiter: opts.noIpLimiter
        ? null
        : {
            limit: async ({ key }) => {
              ipKeys.push(key);
              return { success: opts.allowIp ?? true };
            },
          },
      chatLimiter: opts.noChatLimiter
        ? null
        : {
            limit: async ({ key }) => {
              chatKeys.push(key);
              return { success: opts.allowChat ?? true };
            },
          },
      secret: 'secret' in opts ? opts.secret : SECRET,
      log: (level, message, fields) => logs.push(`${level} ${message} ${JSON.stringify(fields ?? {})}`),
    },
  };
}

const body = { model: '@cf/nvidia/nemotron-3-120b-a12b', messages: [{ role: 'user', content: 'hola' }], max_completion_tokens: 100 };

const post = (payload: unknown, token: string | null = SECRET, path = '/v1/chat', extra: Record<string, string> = {}): Request =>
  new Request(`https://ironman-ai.example.workers.dev${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      'x-ai-client': CLIENT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

test('POST /v1/chat answers { text, finishReason, usage, model }', async () => {
  const f = fake();
  const res = await handleRequest(post(body), f.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: '{"ok":true}', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 }, model: '@cf/nvidia/nemotron-3-120b-a12b' });
  assert.equal(f.calls[0].model, '@cf/nvidia/nemotron-3-120b-a12b');
  assert.deepEqual(f.calls[0].input.chat_template_kwargs, { enable_thinking: false });
  assert.equal(f.calls[0].input.max_completion_tokens, 100);
});

test('auth, routing and validation errors never reach the model or leak the secret', async () => {
  const f = fake();
  const cases: [Request, number, string][] = [
    [post(body, null), 401, 'unauthorized'],
    [post(body, 'wrong-secret'), 401, 'unauthorized'],
    [post(body, SECRET, '/v1/other'), 404, 'not_found'],
    [new Request('https://ironman-ai.example.workers.dev/v1/chat', { method: 'GET', headers: { authorization: `Bearer ${SECRET}` } }), 405, 'method_not_allowed'],
    [post('{not json'), 400, 'bad_request'],
    [post({ ...body, model: 'gpt-4o' }), 400, 'bad_request'],
  ];
  for (const [req, status, code] of cases) {
    const res = await handleRequest(req, f.deps);
    const text = await res.text();
    assert.equal(res.status, status, code);
    assert.equal((JSON.parse(text) as { error: string }).error, code);
    assert.ok(!text.includes(SECRET));
  }
  assert.equal(f.calls.length, 0);
});

test('fails closed: missing limiter bindings or a missing/short secret answer 500 misconfigured', async () => {
  const configs: FakeOptions[] = [{ secret: undefined }, { secret: 'too-short-secret' }, { noIpLimiter: true }, { noChatLimiter: true }];
  for (const config of configs) {
    const f = fake(config);
    const res = await handleRequest(post(body), f.deps);
    assert.equal(res.status, 500, JSON.stringify(config));
    assert.equal(((await res.json()) as { error: string }).error, 'misconfigured');
    assert.equal(f.calls.length, 0);
    assert.ok(f.logs.every((l) => !l.includes(SECRET) && !l.includes('too-short-secret')));
  }
});

test('the IP limit runs before the bearer check (401 floods are throttled); users are limited by x-ai-client', async () => {
  const flooded = fake({ allowIp: false });
  const res = await handleRequest(post(body, 'wrong-secret'), flooded.deps);
  assert.equal(res.status, 429);
  assert.deepEqual(flooded.ipKeys, ['ip:203.0.113.7']);
  assert.deepEqual(flooded.chatKeys, [], 'never reached the per-user limit');

  const f = fake();
  await handleRequest(post(body), f.deps);
  assert.deepEqual(f.chatKeys, [`client:${CLIENT}`]);
  await handleRequest(post(body, SECRET, '/v1/chat', { 'x-ai-client': 'raw-user-id' }), f.deps);
  await handleRequest(post(body, SECRET, '/v1/chat', { 'x-ai-client': '' }), f.deps);
  assert.deepEqual(f.chatKeys.slice(1), ['shared', 'shared'], 'invalid or missing keys share one bucket');

  const unauthorized = fake();
  assert.equal((await handleRequest(post(body, 'wrong-secret'), unauthorized.deps)).status, 401);
  assert.deepEqual(unauthorized.chatKeys, [], 'the per-user limit is only for authenticated calls');
});

test('413 above 3 MB, 429 from the native rate limit', async () => {
  const f = fake();
  const big = JSON.stringify({ ...body, messages: [{ role: 'user', content: 'x'.repeat(MAX_BODY_BYTES) }] });
  const tooLarge = await handleRequest(post(big), f.deps);
  assert.equal(tooLarge.status, 413);
  assert.equal(((await tooLarge.json()) as { error: string }).error, 'too_large');
  const limited = await handleRequest(post(body), fake({ allowChat: false }).deps);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(f.calls.length, 0);
});

test('503 { error: "quota" } when the free daily allocation is used up; 502 for other model errors', async () => {
  const quota = fake({ error: new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons') });
  const res = await handleRequest(post(body), quota.deps);
  assert.equal(res.status, 503);
  const text = await res.text();
  assert.equal((JSON.parse(text) as { error: string }).error, 'quota');
  assert.ok(!text.includes('neurons'), 'the raw upstream message is not echoed');
  const broken = fake({ error: new Error('5007: upstream timeout') });
  const failed = await handleRequest(post(body), broken.deps);
  assert.equal(failed.status, 502);
  assert.equal(((await failed.json()) as { error: string }).error, 'model_error');
  assert.ok(broken.logs.some((l) => l.includes('5007')), 'logged for observability');
  assert.ok(broken.logs.every((l) => !l.includes(SECRET)));
});
