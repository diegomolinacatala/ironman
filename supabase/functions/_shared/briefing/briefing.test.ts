import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeReturning } from '../testing/coach-fakes.ts';
import { briefingRecorder, usageRecorder } from '../testing/ai-fakes.ts';
import type { UsageRecorder } from '../testing/ai-fakes.ts';
import { emptyState, fakeStore, fixedNow, profile, USER, workout } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import { silentLogger } from '../log.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';
import { messageText } from '../coach/ports.ts';
import type { GarminCredential, SyncOutcome } from '../garmin/credentials.ts';
import type { DailyMetrics, SleepSnapshot } from '../types.ts';
import { buildBriefingContext, firstName, promptPayload } from './context.ts';
import { BRIEFING_DAILY_LIMIT, BRIEFING_CONSENT_MESSAGE, handleBriefingHttp, parseBriefingRequest } from './http.ts';
import type { BriefingHttpDeps } from './http.ts';
import { BRIEFING_OUTPUT_JSON_SCHEMA, parseBriefingOutput } from './output.ts';
import type { StoredBriefing } from './ports.ts';
import { BRIEFING_SYSTEM_PROMPT } from './prompt.ts';
import { shouldRefreshGarmin } from './service.ts';
import { formatSleepDuration, hrvBaseline, sleepSnapshot } from './sleep.ts';

const DATE = '2026-10-24';

const SCRIPT = [
  'Buenos días, Diego.',
  'Has dormido siete horas y veinte minutos, con una puntuación de ochenta y uno y la variabilidad de tu pulso un poco por debajo de tu media,',
  'así que el cuerpo viene algo cargado de la semana.',
  'Hoy toca un rodaje suave de cincuenta minutos a las siete y media, en zona dos todo el rato.',
  'La idea es sumar fondo aeróbico sin añadir fatiga, porque mañana tienes la salida larga en bici y quiero que llegues fresco.',
  'Si notas las piernas pesadas, acorta a cuarenta minutos y no pasa nada.',
  'Ayer hiciste una buena sesión de natación, así que hoy menos es más.',
  'Desayuna algo con hidratos una hora antes, bebe agua al levantarte y estira cinco minutos al terminar.',
  'Tu foco de hoy: rodar cómodo, hablar sin ahogarte y guardar energía para mañana.',
].join(' ');

const OUTPUT = {
  headline: "Dormiste 7 h 20' · Hoy rodaje suave 50' a las 7:30",
  sleep_verdict: 'good',
  sleep_summary: '7 h 20 min, puntuación 81 y VFC algo por debajo de tu media.',
  script: SCRIPT,
  focus: 'Rueda cómodo en zona dos y guarda piernas para la bici de mañana.',
};

const metric = (overrides: Partial<DailyMetrics> & { date: string }): DailyMetrics & { userId: string } => ({
  userId: USER,
  source: 'garmin',
  hrvMs: null,
  restingHr: null,
  sleepHours: null,
  sleepScore: null,
  bodyBattery: null,
  trainingReadiness: null,
  vo2max: null,
  steps: null,
  stressAvg: null,
  trainingStatus: null,
  ...overrides,
});

function briefingState(): FakeState {
  const state = emptyState();
  const hrv = [60, 62, 58, 64, 60, 61, 59];
  hrv.forEach((v, i) => state.metrics.push(metric({ date: `2026-10-${String(17 + i).padStart(2, '0')}`, hrvMs: v })));
  state.metrics.push(
    metric({ date: '2026-10-16', hrvMs: 120 }),
    metric({
      date: DATE,
      sleepHours: 7.33,
      sleepScore: 81,
      hrvMs: 52,
      restingHr: 48,
      sleepDeepMin: 80,
      sleepLightMin: 250,
      sleepStart: '2026-10-23T21:10:00.000Z',
      sleepEnd: '2026-10-24T04:40:00.000Z',
    }),
    metric({ date: DATE, source: 'healthkit', restingHr: 55, sleepRemMin: 90, sleepAwakeMin: 12, bodyBattery: 70 }),
  );
  state.workouts.push(
    workout({
      date: DATE,
      startTime: '07:30',
      title: 'Rodaje suave',
      durationMin: 50,
      steps: [{ kind: 'work', durationMin: 50, intensity: 'endurance' }],
    }),
    workout({ date: '2026-10-25', sport: 'bike', title: 'Salida larga', durationMin: 150, startTime: '09:00' }),
    workout({ date: '2026-10-23', sport: 'swim', title: 'Técnica', durationMin: 45, status: 'completed', completed: { durationMin: 47, source: 'garmin' } }),
    workout({ date: '2026-10-26', title: 'Fuera de contexto' }),
  );
  state.busy.push({ id: 'b1', userId: USER, start: '2026-10-24T08:00:00.000Z', end: '2026-10-24T09:00:00.000Z', title: 'Psicólogo' });
  state.races.push({ id: 'r1', userId: USER, name: 'Triatlón de Valencia', date: '2027-04-18', distance: 'half', priority: 'A', location: null, goal: null, notes: null });
  return state;
}

interface Harness {
  deps: BriefingHttpDeps;
  usage: UsageRecorder;
  briefings: ReturnType<typeof briefingRecorder>;
  seen: ClaudeRequest[];
  syncs: GarminCredential[];
}

function harness(opts: {
  state?: FakeState;
  claude?: ClaudePort | null;
  response?: Partial<ClaudeResponse> | Error;
  consentAt?: string | null;
  used?: number;
  cached?: StoredBriefing[];
  credential?: GarminCredential | null;
  sync?: (c: GarminCredential) => Promise<SyncOutcome>;
} = {}): Harness {
  const seen: ClaudeRequest[] = [];
  const syncs: GarminCredential[] = [];
  const usage = usageRecorder({ consentAt: opts.consentAt, used: opts.used });
  const briefings = briefingRecorder((opts.cached ?? []).map((b) => ({ ...b, userId: USER })));
  const claude = opts.claude === undefined ? claudeReturning(opts.response ?? { text: JSON.stringify(OUTPUT) }, seen) : opts.claude;
  const okSync = async (c: GarminCredential): Promise<SyncOutcome> => ({
    ok: true,
    result: { metricsDays: 1, activitiesImported: 0, workoutsCompleted: 0, message: 'ok' },
    status: { provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: c.lastSyncAt, lastError: null },
  });
  const deps: BriefingHttpDeps = {
    reader: fakeStore(opts.state ?? briefingState()),
    briefings: briefings.store,
    usage: usage.store,
    claude,
    garmin:
      opts.credential === undefined
        ? null
        : {
            getCredential: async () => opts.credential ?? null,
            sync: async (c) => {
              syncs.push(c);
              return (opts.sync ?? okSync)(c);
            },
          },
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? USER : null),
    now: fixedNow,
    logger: silentLogger,
  };
  return { deps, usage, briefings, seen, syncs };
}

const post = (body: unknown, auth = 'Bearer good'): Request =>
  new Request('https://x.supabase.co/functions/v1/briefing', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const CACHED: StoredBriefing = {
  date: DATE,
  headline: 'Guardado',
  sleepVerdict: 'fair',
  sleepSummary: 'Noche regular.',
  script: 'Hola.',
  focus: 'Descansa.',
  sleep: null,
  model: 'claude-opus-5-5',
  createdAt: '2026-10-24T05:00:00.000Z',
};

const credential = (lastSyncAt: string | null, state: GarminCredential['state'] = 'connected'): GarminCredential => ({
  userId: USER,
  ciphertext: 'c',
  keyExpiresAt: null,
  state,
  lastSyncAt,
  lastError: null,
});

test('briefing request: date required and real, refresh optional', () => {
  assert.deepEqual(parseBriefingRequest({ date: DATE }), { ok: true, value: { date: DATE, refresh: false } });
  assert.equal(parseBriefingRequest({ date: DATE, refresh: true, extra: 1 }).ok, true);
  assert.equal(parseBriefingRequest({ date: '2026-02-30' }).ok, false);
  assert.equal(parseBriefingRequest({}).ok, false);
  assert.equal(parseBriefingRequest({ date: DATE, refresh: 'yes' }).ok, false);
});

test('briefing HTTP: a stored briefing is returned as is, without the API key, consent or quota', async () => {
  const h = harness({ claude: null, consentAt: null, used: BRIEFING_DAILY_LIMIT, cached: [CACHED] });
  const res = await handleBriefingHttp(post({ date: DATE }), h.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(body, {
    date: DATE,
    headline: 'Guardado',
    sleepVerdict: 'fair',
    sleepSummary: 'Noche regular.',
    script: 'Hola.',
    focus: 'Descansa.',
    sleep: null,
    engine: 'ai',
    createdAt: '2026-10-24T05:00:00.000Z',
  });
  assert.equal(h.usage.reservations.length, 0, 'cached reads never reserve AI quota');
});

test('briefing HTTP: 401, 400, 405, 204 and 503 without API key when nothing is stored', async () => {
  const h = harness({ claude: null });
  assert.equal((await handleBriefingHttp(post({ date: DATE }, 'Bearer bad'), h.deps)).status, 401);
  assert.equal((await handleBriefingHttp(post({ date: 'ayer' }), h.deps)).status, 400);
  assert.equal((await handleBriefingHttp(new Request('https://x/briefing', { method: 'GET' }), h.deps)).status, 405);
  assert.equal((await handleBriefingHttp(new Request('https://x/briefing', { method: 'OPTIONS' }), h.deps)).status, 204);
  const res = await handleBriefingHttp(post({ date: DATE }), h.deps);
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: string }).error, 'ai_unavailable');
});

test('briefing HTTP: 403 consent_required and 429 after 12 generations, before calling Claude', async () => {
  const noConsent = harness({ consentAt: null });
  const denied = await handleBriefingHttp(post({ date: DATE }), noConsent.deps);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'consent_required', message: BRIEFING_CONSENT_MESSAGE });
  assert.equal(noConsent.seen.length, 0);
  const full = harness({ used: BRIEFING_DAILY_LIMIT });
  const limited = await handleBriefingHttp(post({ date: DATE }), full.deps);
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { error: string }).error, 'rate_limited');
  assert.equal(full.seen.length, 0);
  assert.deepEqual(full.usage.reservations, [{ functionName: 'briefing', limit: BRIEFING_DAILY_LIMIT }]);
  const almost = harness({ used: BRIEFING_DAILY_LIMIT - 1 });
  assert.equal((await handleBriefingHttp(post({ date: DATE }), almost.deps)).status, 200);
});

test('briefing HTTP: only today or tomorrow can be generated', async () => {
  const h = harness();
  assert.equal((await handleBriefingHttp(post({ date: '2026-11-30' }), h.deps)).status, 400);
  assert.equal((await handleBriefingHttp(post({ date: '2026-10-25' }), h.deps)).status, 200);
});

test('briefing HTTP: generates with Claude, stores the row and returns the computed sleep snapshot', async () => {
  const h = harness({ cached: [CACHED] });
  const res = await handleBriefingHttp(post({ date: DATE, refresh: true }), h.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { engine: string; headline: string; sleepVerdict: string; script: string; sleep: SleepSnapshot; createdAt: string };
  assert.equal(body.engine, 'ai');
  assert.equal(body.headline, OUTPUT.headline);
  assert.equal(body.sleepVerdict, 'good');
  assert.equal(body.script, SCRIPT);
  assert.equal(body.createdAt, '2026-10-24T10:00:00.000Z');
  assert.deepEqual(body.sleep, {
    hours: 7.33,
    score: 81,
    deepMin: 80,
    lightMin: 250,
    remMin: 90,
    awakeMin: 12,
    start: '2026-10-23T21:10:00.000Z',
    end: '2026-10-24T04:40:00.000Z',
    hrvMs: 52,
    hrvBaselineMs: 61,
    restingHr: 48,
    bodyBattery: 70,
  });
  assert.equal(h.briefings.upserts, 1);
  assert.equal(h.briefings.rows.get(`${USER}:${DATE}`)?.model, 'claude-opus-5-5');
  assert.deepEqual(
    h.usage.rows.map((r) => [r.functionName, r.model, r.inputTokens, r.outputTokens]),
    [['briefing', 'claude-opus-5-5', 1000, 200]],
    'reserved before the call, completed with the model and tokens',
  );
  const req = h.seen[0];
  assert.equal(req.effort, 'low');
  assert.equal(req.maxTokens, 4000);
  assert.equal(req.system, BRIEFING_SYSTEM_PROMPT);
  assert.equal(req.schema, BRIEFING_OUTPUT_JSON_SCHEMA);
  assert.ok(req.signal instanceof AbortSignal);
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, 'user');
});

test('briefing context: no calendar titles, local times, HRV vs 7-night baseline, today/tomorrow/yesterday', async () => {
  const ctx = await buildBriefingContext(fakeStore(briefingState()), { userId: USER, date: DATE, now: fixedNow() });
  const sent = JSON.stringify(promptPayload(ctx));
  assert.ok(!sent.includes('Psicólogo'), 'busy titles never reach Claude');
  assert.deepEqual(ctx.busyToday, [{ start: '10:00', end: '11:00' }]);
  assert.equal(ctx.sleepView?.bedtime, '23:10');
  assert.equal(ctx.sleepView?.wakeTime, '06:40');
  assert.equal(ctx.sleepView?.duration, '7 h 20 min');
  assert.equal(ctx.sleepView?.hrvVsBaselinePct, -15);
  assert.deepEqual(ctx.todayWorkouts.map((w) => w.title), ['Rodaje suave']);
  assert.equal((ctx.todayWorkouts[0].steps as { intensity: string }[])[0].intensity, 'Fondo (Z2)');
  assert.deepEqual(ctx.tomorrowWorkouts.map((w) => w.title), ['Salida larga']);
  assert.deepEqual(ctx.yesterday, { sessions: [ctx.yesterday.sessions[0]], totalMin: 47, load: ctx.yesterday.load });
  assert.equal(ctx.yesterday.sessions[0].title, 'Técnica');
  assert.ok(!sent.includes('Fuera de contexto'));
  assert.equal(ctx.race?.daysToRace, 176);
  assert.equal(ctx.athlete.name, 'Diego');
  assert.ok(!sent.includes(USER), 'no ids in the prompt');
});

test('sleep snapshot: Garmin first then Apple Health per field; baseline needs 3 nights; null without data', () => {
  const rows = briefingState().metrics;
  const snap = sleepSnapshot(rows, DATE);
  assert.equal(snap?.restingHr, 48, 'Garmin wins');
  assert.equal(snap?.remMin, 90, 'Apple Health fills the gap');
  assert.equal(hrvBaseline(rows, DATE), 61, 'mean of the previous 7 nights only (the 16th is excluded)');
  assert.equal(hrvBaseline([metric({ date: '2026-10-23', hrvMs: 60 }), metric({ date: '2026-10-22', hrvMs: 70 })], DATE), null);
  assert.equal(sleepSnapshot([metric({ date: '2026-10-23', sleepHours: 7 })], DATE), null);
  assert.equal(sleepSnapshot([metric({ date: DATE })], DATE), null, 'an empty row is no data');
  assert.equal(formatSleepDuration(7.33), '7 h 20 min');
  assert.equal(formatSleepDuration(8), '8 h');
});

test('briefing output: plain text, clipped headline, verdict unknown without sleep, broken scripts rejected', () => {
  const messy = parseBriefingOutput(
    {
      ...OUTPUT,
      headline: '**Dormiste genial** 😴 · Hoy rodaje suave de cincuenta minutos a las siete y media de la mañana con calma total',
      script: `# Hola\n- ${SCRIPT} 💪`,
    },
    false,
  );
  assert.ok(messy.headline.length <= 90);
  assert.ok(messy.headline.endsWith('…'));
  assert.ok(!/[*😴]/u.test(messy.headline));
  assert.ok(!/[#💪]/u.test(messy.script) && !messy.script.startsWith('-'));
  assert.equal(messy.sleepVerdict, 'unknown');
  assert.throws(() => parseBriefingOutput({ ...OUTPUT, script: 'Hola Diego, hoy rodaje.' }, true), (e: unknown) => e instanceof CoachAiError && e.code === 'bad_output');
  assert.throws(() => parseBriefingOutput({ ...OUTPUT, sleep_verdict: 'meh' }, true), CoachAiError);
  const schema = BRIEFING_OUTPUT_JSON_SCHEMA as { required: string[]; additionalProperties: boolean };
  assert.deepEqual(schema.required, ['headline', 'sleep_verdict', 'sleep_summary', 'script', 'focus']);
  assert.equal(schema.additionalProperties, false);
  assert.ok(!JSON.stringify(schema).includes('minLength'));
  assert.ok(!BRIEFING_SYSTEM_PROMPT.includes('2026'), 'system prompt stays static (cacheable)');
});

test('briefing HTTP: AI failures answer 503 ai_unavailable (usage recorded when tokens were spent)', async () => {
  const cases: (Partial<ClaudeResponse> | Error)[] = [
    { text: '{"headline":' },
    { stopReason: 'refusal', text: '' },
    { stopReason: 'max_tokens', text: '{' },
    { text: JSON.stringify({ ...OUTPUT, script: 'Corto.' }) },
    new CoachAiError('overloaded', 'saturado'),
  ];
  for (const response of cases) {
    const h = harness({ response });
    const res = await handleBriefingHttp(post({ date: DATE }), h.deps);
    assert.equal(res.status, 503, JSON.stringify(response));
    assert.equal(((await res.json()) as { error: string }).error, 'ai_unavailable');
    assert.equal(h.briefings.upserts, 0);
    assert.equal(h.usage.rows.length, 1, 'failed calls stay counted');
    assert.equal(h.usage.rows[0].model, response instanceof Error ? null : 'claude-opus-5-5');
  }
  const broken = harness({ response: new Error('db exploded') });
  assert.equal((await handleBriefingHttp(post({ date: DATE }), broken.deps)).status, 500);
});

test('briefing: Garmin is refreshed first when connected and stale; fresh, expired or failing syncs never block', async () => {
  assert.equal(shouldRefreshGarmin(null, fixedNow()), false);
  assert.equal(shouldRefreshGarmin(credential('2026-10-24T09:45:00.000Z'), fixedNow()), false, '15 min ago');
  assert.equal(shouldRefreshGarmin(credential('2026-10-24T09:00:00.000Z'), fixedNow()), true, '60 min ago');
  assert.equal(shouldRefreshGarmin(credential(null), fixedNow()), true);
  assert.equal(shouldRefreshGarmin(credential(null, 'expired'), fixedNow()), false);

  const stale = harness({ credential: credential('2026-10-24T09:00:00.000Z') });
  assert.equal((await handleBriefingHttp(post({ date: DATE }), stale.deps)).status, 200);
  assert.equal(stale.syncs.length, 1);

  const fresh = harness({ credential: credential('2026-10-24T09:50:00.000Z') });
  await handleBriefingHttp(post({ date: DATE }), fresh.deps);
  assert.equal(fresh.syncs.length, 0);

  const failing = harness({ credential: credential(null), sync: async () => Promise.reject(new Error('garmin down')) });
  assert.equal((await handleBriefingHttp(post({ date: DATE }), failing.deps)).status, 200);
  assert.equal(failing.syncs.length, 1);

  const hanging = harness({ credential: credential(null), sync: () => new Promise<SyncOutcome>(() => undefined) });
  hanging.deps = { ...hanging.deps, garminTimeoutMs: 20 };
  assert.equal((await handleBriefingHttp(post({ date: DATE }), hanging.deps)).status, 200, 'a hanging sync is abandoned');
});

test('briefing: the Claude message carries the context JSON and no busy titles', async () => {
  const h = harness();
  await handleBriefingHttp(post({ date: DATE }), h.deps);
  const text = messageText(h.seen[0].messages[0]);
  assert.match(text, /Prepara el informe de la mañana del 2026-10-24 \(sábado\)/);
  assert.ok(text.includes('"busyToday":[{"start":"10:00","end":"11:00"}]'));
  assert.ok(!text.includes('Psicólogo'));
});

test('briefing context: only the first name reaches the model', async () => {
  const state = briefingState();
  state.profiles = [profile({ displayName: '  Diego Molina Catalá ' })];
  const sent = JSON.stringify(promptPayload(await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() })));
  assert.ok(sent.includes('"name":"Diego"'));
  assert.ok(!sent.includes('Molina') && !sent.includes('Catalá'));
  assert.equal(firstName(''), 'atleta');
});
