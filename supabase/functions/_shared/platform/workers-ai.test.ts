import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseAiProvider, DEFAULT_WORKERS_MODEL, DEFAULT_WORKERS_VISION_MODEL } from '../ai/provider.ts';
import { BRIEFING_OUTPUT_JSON_SCHEMA } from '../briefing/output.ts';
import { handleBriefingHttp } from '../briefing/http.ts';
import { TIMEOUT_MESSAGE } from '../coach/deadline.ts';
import { runCoachJob } from '../coach/job.ts';
import { COACH_OUTPUT_JSON_SCHEMA } from '../coach/output.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { ClaudeRequest } from '../coach/ports.ts';
import { silentLogger } from '../log.ts';
import { handleMealHttp } from '../meal/http.ts';
import { MEAL_OUTPUT_JSON_SCHEMA } from '../meal/output.ts';
import { briefingRecorder, usageRecorder } from '../testing/ai-fakes.ts';
import { coachJob, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { emptyState, fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import { chatBody, cleanModelJson, clientKey, createWorkersAiPort, QUOTA_MESSAGE, toChatMessages, toStrictSchema } from './workers-ai.ts';
import type { FetchFn } from './workers-ai.ts';

const MODEL = '@cf/nvidia/nemotron-3-120b-a12b';
const SECRET = 'worker-shared-secret-0123456789abcdef';

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>, calls: Call[] = []): FetchFn {
  return async (url, init) => {
    const call = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  };
}

const ok = (text: string, extra: Record<string, unknown> = {}): Response =>
  Response.json({ text, finishReason: 'stop', usage: { inputTokens: 900, outputTokens: 120 }, model: MODEL, ...extra });

const port = (fetch: FetchFn, url = 'https://ironman-ai.example.workers.dev/') => createWorkersAiPort({ url, secret: SECRET, model: MODEL, fetch });

const request = (overrides: Partial<ClaudeRequest> = {}): ClaudeRequest => ({
  system: 'Eres un coach.',
  messages: [{ role: 'user', content: 'hola' }],
  effort: 'low',
  schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false },
  maxTokens: 4000,
  ...overrides,
});

/** Every object node of a schema (to check strict-mode rules everywhere). */
function objectNodes(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(objectNodes);
  if (typeof node !== 'object' || node === null) return [];
  const n = node as Record<string, unknown>;
  const self = n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object')) ? [n] : [];
  return [...self, ...Object.values(n).flatMap(objectNodes)];
}

test('provider choice: Workers AI first (secret ≥ 32 chars), then Claude, else none; models per purpose', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  assert.deepEqual(chooseAiProvider(env({ AI_WORKER_URL: 'https://w', AI_WORKER_SECRET: SECRET, ANTHROPIC_API_KEY: 'k' }), 'text'), {
    kind: 'workers',
    url: 'https://w',
    secret: SECRET,
    model: DEFAULT_WORKERS_MODEL,
  });
  assert.equal((chooseAiProvider(env({ AI_WORKER_URL: 'https://w', AI_WORKER_SECRET: SECRET }), 'vision') as { model: string }).model, DEFAULT_WORKERS_VISION_MODEL);
  assert.deepEqual(chooseAiProvider(env({ AI_WORKER_URL: 'https://w', AI_WORKER_SECRET: 'short', ANTHROPIC_API_KEY: 'k' }), 'text'), { kind: 'claude', apiKey: 'k' });
  const custom = env({ AI_WORKER_URL: 'https://w', AI_WORKER_SECRET: SECRET, AI_MODEL: '@cf/nvidia/nemotron-3-120b-a12b', AI_VISION_MODEL: '@cf/google/gemma-4-26b-a4b-it' });
  assert.equal((chooseAiProvider(custom, 'text') as { model: string }).model, '@cf/nvidia/nemotron-3-120b-a12b');
  assert.equal((chooseAiProvider(custom, 'vision') as { model: string }).model, '@cf/google/gemma-4-26b-a4b-it');
  assert.deepEqual(chooseAiProvider(env({ AI_WORKER_URL: 'https://w', ANTHROPIC_API_KEY: 'k' }), 'vision'), { kind: 'claude', apiKey: 'k' });
  assert.deepEqual(chooseAiProvider(env({ AI_WORKER_SECRET: '  ' }), 'text'), { kind: 'none' });
});

test('messages: system first, same-role turns merged, images as data URLs', () => {
  const messages = toChatMessages('SYS', [
    { role: 'user', content: 'contexto' },
    { role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', base64: '/9j/AAAA' }, { type: 'text', text: '¿Qué es?' }] },
    { role: 'assistant', content: 'Respuesta' },
    { role: 'user', content: 'gracias' },
  ]);
  assert.deepEqual(messages, [
    { role: 'system', content: 'SYS' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'contexto' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AAAA' } },
        { type: 'text', text: '¿Qué es?' },
      ],
    },
    { role: 'assistant', content: 'Respuesta' },
    { role: 'user', content: 'gracias' },
  ]);
  assert.deepEqual(toChatMessages('S', [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }])[1], { role: 'user', content: 'a\n\nb' });
});

test('chat body: strict json_schema, effort → enable_thinking, maxTokens → max_completion_tokens', () => {
  const low = chatBody(request(), MODEL);
  assert.equal(low.model, MODEL);
  assert.equal(low.enable_thinking, false);
  assert.equal(low.max_completion_tokens, 4000);
  assert.deepEqual((low.response_format as { json_schema: { name: string; strict: boolean } }).json_schema.name, 'output');
  assert.equal((low.response_format as { json_schema: { strict: boolean } }).json_schema.strict, true);
  assert.equal(chatBody(request({ effort: 'medium' }), MODEL).enable_thinking, true);
});

test('strict schemas: no anyOf/format, nullable as type arrays, every property required, no extra properties', () => {
  for (const schema of [COACH_OUTPUT_JSON_SCHEMA, BRIEFING_OUTPUT_JSON_SCHEMA, MEAL_OUTPUT_JSON_SCHEMA]) {
    const strict = toStrictSchema(schema);
    const text = JSON.stringify(strict);
    assert.ok(!text.includes('anyOf') && !text.includes('"format"'), text.slice(0, 120));
    for (const node of objectNodes(strict)) {
      assert.deepEqual(node.required, Object.keys(node.properties as object));
      assert.equal(node.additionalProperties, false);
    }
  }
  const coach = toStrictSchema(COACH_OUTPUT_JSON_SCHEMA) as {
    properties: { life_event: { type: string[] }; changes: { items: { properties: { sport: { type: string[]; enum: unknown[] }; workoutId: { type: string[] } } } } };
  };
  assert.deepEqual(coach.properties.life_event.type, ['object', 'null']);
  assert.deepEqual(coach.properties.changes.items.properties.workoutId.type, ['string', 'null']);
  assert.deepEqual(coach.properties.changes.items.properties.sport.type, ['string', 'null']);
  assert.ok(coach.properties.changes.items.properties.sport.enum.includes(null));
  assert.ok(JSON.stringify(COACH_OUTPUT_JSON_SCHEMA).includes('anyOf'), 'the Claude schema itself is unchanged');
});

test('model text is cleaned to JSON: fences, <think>, prose around it, double-encoded strings', () => {
  assert.equal(cleanModelJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(cleanModelJson('<think>razono…</think>\n{"a":1}'), '{"a":1}');
  assert.equal(cleanModelJson('Aquí tienes: {"a":{"b":2}} ¡Suerte!'), '{"a":{"b":2}}');
  assert.equal(cleanModelJson(JSON.stringify('{"a":1}')), '{"a":1}');
  assert.equal(cleanModelJson('sin json'), 'sin json');
});

test('generate: POST /v1/chat with the bearer secret; answer mapped to the Claude response shape', async () => {
  const calls: Call[] = [];
  const res = await port(fakeFetch(() => ok('```json\n{"a":"b"}\n```'), calls)).generate(request());
  assert.equal(calls[0].url, 'https://ironman-ai.example.workers.dev/v1/chat');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);
  assert.equal(calls[0].body.model, MODEL);
  assert.deepEqual(res, { text: '{"a":"b"}', stopReason: 'end_turn', model: MODEL, inputTokens: 900, outputTokens: 120, fallbackUsed: false });
  const cut = await port(fakeFetch(() => ok('{"a":', { finishReason: 'max_tokens' }))).generate(request());
  assert.equal(cut.stopReason, 'max_tokens');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-ai-client'], undefined, 'no user → shared bucket');
});

test('per-user rate-limit key: x-ai-client = hex HMAC-SHA256(secret, userId), never the raw id', async () => {
  const calls: Call[] = [];
  await port(fakeFetch(() => ok('{"a":"b"}'), calls)).generate(request({ userId: USER }));
  const header = (calls[0].init.headers as Record<string, string>)['x-ai-client'];
  assert.match(header, /^[0-9a-f]{64}$/);
  assert.ok(!header.includes(USER.replace(/-/g, '')));
  assert.ok(!JSON.stringify(calls[0].body).includes(USER), 'the id is not in the body either');
  assert.equal(header, await clientKey(SECRET, USER), 'stable per user');
  assert.notEqual(header, await clientKey(SECRET, '22222222-2222-4222-8222-222222222222'));
  assert.notEqual(header, await clientKey(`${SECRET}x`, USER), 'depends on the secret');
});

test('generate: worker errors become Spanish CoachAiErrors (quota, rate limit, auth, model, network, timeout)', async () => {
  const cases: [Response | Error, string, RegExp][] = [
    [Response.json({ error: 'quota', message: 'used up' }, { status: 503 }), 'quota', /límite de hoy/],
    [Response.json({ error: 'rate_limited' }, { status: 429 }), 'rate_limited', /saturada/],
    [Response.json({ error: 'unauthorized' }, { status: 401 }), 'auth', /configurada/],
    [Response.json({ error: 'model_error' }, { status: 502 }), 'overloaded', /no está disponible/],
    [Response.json({ error: 'bad_request' }, { status: 400 }), 'api', /procesar/],
    [new Response('<html>oops</html>', { status: 200 }), 'api', /no válida/],
    [new TypeError('fetch failed'), 'network', /conectar/],
  ];
  for (const [answer, code, message] of cases) {
    const fetch = fakeFetch(() => (answer instanceof Error ? Promise.reject(answer) : answer));
    await assert.rejects(port(fetch).generate(request()), (e: unknown) => e instanceof CoachAiError && e.code === code && message.test(e.message), code);
  }
  const controller = new AbortController();
  const hanging = fakeFetch(
    ({ init }) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
  );
  const pending = port(hanging).generate(request({ signal: controller.signal }));
  controller.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof CoachAiError && e.code === 'timeout' && e.message === TIMEOUT_MESSAGE);
});

test('free quota used up: briefing and meal answer 503 ai_unavailable with the quota message; the coach job fails with it', async () => {
  const quota = port(fakeFetch(() => Response.json({ error: 'quota' }, { status: 503 })));
  const post = (path: string, body: unknown): Request =>
    new Request(`https://x.supabase.co/functions/v1/${path}`, { method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify(body) });
  const authenticate = async (): Promise<string> => USER;
  const briefing = await handleBriefingHttp(post('briefing', { date: '2026-10-24' }), {
    reader: fakeStore(emptyState()),
    briefings: briefingRecorder().store,
    usage: usageRecorder().store,
    claude: quota,
    garmin: null,
    authenticate,
    now: fixedNow,
    logger: silentLogger,
  });
  assert.equal(briefing.status, 503);
  assert.deepEqual(await briefing.json(), { error: 'ai_unavailable', message: QUOTA_MESSAGE });
  const meal = await handleMealHttp(post('meal', { date: '2026-10-24', time: '14:00', text: 'Lentejas' }), {
    reader: fakeStore(emptyState()),
    usage: usageRecorder({ functionName: 'meal' }).store,
    claude: quota,
    authenticate,
    now: fixedNow,
    logger: silentLogger,
  });
  assert.equal(meal.status, 503);
  assert.deepEqual(await meal.json(), { error: 'ai_unavailable', message: QUOTA_MESSAGE });
  const rec = runningRecorder();
  await runCoachJob({ reader: fakeStore(stateWithWeek()), store: rec.store, claude: quota, now: fixedNow, logger: silentLogger }, coachJob());
  assert.equal(rec.jobs[0].status, 'error');
  assert.equal(rec.jobs[0].error, QUOTA_MESSAGE);
});

test('a Workers AI answer flows through the coach job and records the Workers model in ai_usage', async () => {
  const rec = runningRecorder();
  const answer = JSON.stringify({ reply: 'Descansa hoy, mañana rodaje suave.', summary: '', changes: [], memory: [], life_event: null });
  const calls: Call[] = [];
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: rec.store, claude: port(fakeFetch(() => ok(`Claro:\n${answer}`), calls)), now: fixedNow, logger: silentLogger },
    coachJob({ mode: 'chat' }),
  );
  assert.equal(rec.jobs[0].status, 'done');
  assert.match(rec.jobs[0].reply ?? '', /Descansa hoy/);
  assert.deepEqual(rec.usage, [{ model: MODEL, inputTokens: 900, outputTokens: 120 }]);
  assert.match((calls[0].init.headers as Record<string, string>)['x-ai-client'], /^[0-9a-f]{64}$/, 'coach calls carry the user key');
  const sent = calls[0].body.messages as { role: string }[];
  assert.deepEqual(sent.map((m) => m.role), ['system', 'user'], 'context + message merged into one user turn');
  assert.equal(calls[0].body.enable_thinking, false, 'chat → effort low');
});
