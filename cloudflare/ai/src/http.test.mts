import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BODY_BYTES } from './chat.mts';
import { handleRequest } from './http.mts';
import type { HandlerDeps } from './http.mts';
import { BASIC_SPEECH_MODEL, MAX_SPEECH_BODY_BYTES, PREMIUM_SPEECH_MODEL } from './speech.mts';

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
  /** Per-model behaviour (overrides output / error). */
  run?: (model: string, input: Record<string, unknown>) => unknown;
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
          if (opts.run) return opts.run(model, input);
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

// ---------- POST /v1/speech ----------

const SPOKEN = 'Hoy toca rodaje suave de cuarenta minutos en zona dos.';
const speech = { text: SPOKEN, voice: 'diana', tier: 'premium' };
const MP3 = new Uint8Array([0xff, 0xf3, 0x44, 0xc4, 1, 2, 3]);
const WAV = new TextEncoder().encode('RIFF$\u0000\u0000\u0000WAVEfmt data');
const WAV_B64 = Buffer.from(WAV).toString('base64');
const QUOTA = new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons');

const mp3Stream = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(MP3.slice(0, 3));
      controller.enqueue(MP3.slice(3));
      controller.close();
    },
  });

const raise = (e: Error) => (): never => {
  throw e;
};

/** Aura answers with `premium()`, MeloTTS with `basic()` (either may throw). */
const speechAi =
  (premium: () => unknown, basic: () => unknown = () => ({ audio: WAV_B64 })) =>
  (model: string): unknown => {
    if (model === PREMIUM_SPEECH_MODEL) return premium();
    if (model === BASIC_SPEECH_MODEL) return basic();
    throw new Error(`unexpected model ${model}`);
  };

const postSpeech = (payload: unknown, token: string | null = SECRET): Request => post(payload, token, '/v1/speech');

const bytesOf = async (res: Response): Promise<Uint8Array> => new Uint8Array(await res.arrayBuffer());

test('POST /v1/speech premium buffers the Aura 2 stream and answers audio/mpeg', async () => {
  const f = fake({ run: speechAi(mp3Stream) });
  const res = await handleRequest(postSpeech(speech), f.deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-speech-model'), PREMIUM_SPEECH_MODEL);
  assert.deepEqual(await bytesOf(res), MP3);
  assert.deepEqual(f.calls, [{ model: PREMIUM_SPEECH_MODEL, input: { text: SPOKEN, speaker: 'diana', encoding: 'mp3' } }]);
  assert.deepEqual(f.logs, []);
});

test('POST /v1/speech premium also accepts Uint8Array / ArrayBuffer outputs', async () => {
  for (const output of [MP3, MP3.slice().buffer]) {
    const res = await handleRequest(postSpeech(speech), fake({ run: speechAi(() => output) }).deps);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-speech-model'), PREMIUM_SPEECH_MODEL);
    assert.deepEqual(await bytesOf(res), MP3);
  }
});

test('POST /v1/speech basic decodes the MeloTTS base64 WAV and answers audio/wav', async () => {
  const f = fake({ run: speechAi(raise(new Error('premium must not run'))) });
  const res = await handleRequest(postSpeech({ ...speech, tier: 'basic' }), f.deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-speech-model'), BASIC_SPEECH_MODEL);
  assert.deepEqual(await bytesOf(res), WAV);
  assert.deepEqual(f.calls, [{ model: BASIC_SPEECH_MODEL, input: { prompt: SPOKEN, lang: 'es' } }]);
});

test('POST /v1/speech premium falls back to basic on quota, model errors, mid-stream failures and empty audio', async () => {
  const failures: [string, () => unknown][] = [
    ['quota', raise(QUOTA)],
    ['model error', raise(new Error(`5007: could not synthesize "${SPOKEN}"`))],
    ['mid-stream failure', () => new ReadableStream({ pull: (c) => c.error(new Error('stream reset')) })],
    ['empty stream', () => new ReadableStream({ start: (c) => c.close() })],
    ['empty bytes', () => new Uint8Array(0)],
    ['unknown shape', () => ({ nope: true })],
  ];
  for (const [label, premium] of failures) {
    const f = fake({ run: speechAi(premium) });
    const res = await handleRequest(postSpeech(speech), f.deps);
    assert.equal(res.status, 200, label);
    assert.equal(res.headers.get('content-type'), 'audio/wav', label);
    assert.equal(res.headers.get('x-speech-model'), BASIC_SPEECH_MODEL, label);
    assert.deepEqual(await bytesOf(res), WAV, label);
    assert.deepEqual(f.calls.map((c) => c.model), [PREMIUM_SPEECH_MODEL, BASIC_SPEECH_MODEL], label);
    assert.equal(f.logs.length, 1, label);
    assert.ok(f.logs[0].startsWith('warn premium speech failed, falling back to basic'), label);
    assert.ok(f.logs.every((l) => !l.includes(SPOKEN) && !l.includes(SECRET)), `${label}: never logs the text or the secret`);
  }
});

test('POST /v1/speech: basic quota → 503 quota, other basic errors or empty audio → 502 model_error', async () => {
  const quota = fake({ run: speechAi(raise(QUOTA), raise(QUOTA)) });
  const res = await handleRequest(postSpeech(speech), quota.deps);
  assert.equal(res.status, 503);
  const text = await res.text();
  assert.equal((JSON.parse(text) as { error: string }).error, 'quota');
  assert.ok(!text.includes('neurons'), 'the raw upstream message is not echoed');
  assert.deepEqual(quota.calls.map((c) => c.model), [PREMIUM_SPEECH_MODEL, BASIC_SPEECH_MODEL]);

  const basicQuota = await handleRequest(postSpeech({ ...speech, tier: 'basic' }), fake({ run: speechAi(mp3Stream, raise(QUOTA)) }).deps);
  assert.equal(basicQuota.status, 503);

  const brokenBasics: [string, () => unknown][] = [
    ['model error', raise(new Error(`5007: upstream timeout for "${SPOKEN}"`))],
    ['empty audio', () => ({ audio: '' })],
    ['invalid base64', () => ({ audio: '%%%' })],
  ];
  for (const [label, basic] of brokenBasics) {
    const f = fake({ run: speechAi(raise(new Error('5007: aura down')), basic) });
    const failed = await handleRequest(postSpeech(speech), f.deps);
    assert.equal(failed.status, 502, label);
    const body = (await failed.json()) as { error: string; message: string };
    assert.equal(body.error, 'model_error', label);
    assert.ok(!body.message.includes(SPOKEN), label);
    assert.ok(f.logs.some((l) => l.startsWith('error workers ai failed')), `${label}: logged for observability`);
    assert.ok(f.logs.every((l) => !l.includes(SPOKEN) && !l.includes(SECRET)), `${label}: never logs the text or the secret`);
  }
});

test('POST /v1/speech validation errors answer 400 bad_request and never reach the model', async () => {
  const f = fake({ run: speechAi(mp3Stream) });
  const cases: unknown[] = [
    '{not json',
    { ...speech, text: '' },
    { ...speech, text: '    ' },
    { ...speech, text: 'a'.repeat(601) },
    { ...speech, text: 'hola\u0007' },
    { ...speech, voice: 'luna' },
    { ...speech, tier: 'gold' },
    [],
  ];
  for (const payload of cases) {
    const res = await handleRequest(postSpeech(payload), f.deps);
    assert.equal(res.status, 400, JSON.stringify(payload).slice(0, 60));
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'bad_request');
    assert.ok(body.message.length > 0);
  }
  assert.equal(f.calls.length, 0);
});

test('POST /v1/speech has the same auth, limiter ordering and fail-closed config as /v1/chat', async () => {
  const unauthorized = fake({ run: speechAi(mp3Stream) });
  for (const token of [null, 'wrong-secret']) {
    const res = await handleRequest(postSpeech(speech, token), unauthorized.deps);
    assert.equal(res.status, 401);
    assert.ok(!(await res.text()).includes(SECRET));
  }
  assert.deepEqual(unauthorized.ipKeys, ['ip:203.0.113.7', 'ip:203.0.113.7'], 'the IP limit runs before auth');
  assert.deepEqual(unauthorized.chatKeys, [], 'the per-user limit is only for authenticated calls');
  assert.equal(unauthorized.calls.length, 0);

  const flooded = fake({ allowIp: false, run: speechAi(mp3Stream) });
  assert.equal((await handleRequest(postSpeech(speech, 'wrong-secret'), flooded.deps)).status, 429);
  assert.deepEqual(flooded.chatKeys, []);

  const limited = fake({ allowChat: false, run: speechAi(mp3Stream) });
  const res = await handleRequest(postSpeech(speech), limited.deps);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.deepEqual(limited.chatKeys, [`client:${CLIENT}`], 'shares CHAT_LIMITER, keyed by x-ai-client');
  assert.equal(limited.calls.length, 0);

  const configs: FakeOptions[] = [{ secret: undefined }, { secret: 'too-short-secret' }, { noIpLimiter: true }, { noChatLimiter: true }];
  for (const config of configs) {
    const f = fake({ ...config, run: speechAi(mp3Stream) });
    const misconfigured = await handleRequest(postSpeech(speech), f.deps);
    assert.equal(misconfigured.status, 500, JSON.stringify(config));
    assert.equal(((await misconfigured.json()) as { error: string }).error, 'misconfigured');
    assert.equal(f.calls.length, 0);
  }
});

test('POST /v1/speech: 413 above its small body limit; 404 names both routes; 405 for other methods', async () => {
  const f = fake({ run: speechAi(mp3Stream) });
  const big = JSON.stringify({ ...speech, text: 'x'.repeat(MAX_SPEECH_BODY_BYTES) });
  const tooLarge = await handleRequest(postSpeech(big), f.deps);
  assert.equal(tooLarge.status, 413);
  assert.equal(((await tooLarge.json()) as { error: string }).error, 'too_large');
  assert.equal(f.calls.length, 0);

  const notFound = await handleRequest(post(speech, SECRET, '/v1/speak'), f.deps);
  assert.equal(notFound.status, 404);
  const { message } = (await notFound.json()) as { message: string };
  assert.ok(message.includes('/v1/chat') && message.includes('/v1/speech'), message);
  assert.equal((await handleRequest(post(speech, SECRET, '/toString'), f.deps)).status, 404, 'no prototype keys as routes');

  const get = await handleRequest(new Request('https://ironman-ai.example.workers.dev/v1/speech', { method: 'GET', headers: { authorization: `Bearer ${SECRET}` } }), f.deps);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
});
