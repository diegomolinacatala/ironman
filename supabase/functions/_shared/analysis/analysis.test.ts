import assert from 'node:assert/strict';
import test from 'node:test';
import { CoachAiError, messageText } from '../coach/ports.ts';
import type { ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';
import { silentLogger } from '../log.ts';
import { usageRecorder } from '../testing/ai-fakes.ts';
import type { UsageRecorder } from '../testing/ai-fakes.ts';
import { claudeReturning } from '../testing/coach-fakes.ts';
import { emptyState, fakeStore, fixedNow, USER, workout } from '../testing/fakes.ts';
import type { UUID, Workout, WorkoutAnalysis } from '../types.ts';
import { analysisMessage } from './context.ts';
import { ANALYSIS_CONSENT_MESSAGE, ANALYSIS_DAILY_LIMIT, handleAnalysisHttp } from './http.ts';
import type { AnalysisHttpDeps, AnalysisStore } from './http.ts';
import { ANALYSIS_OUTPUT_JSON_SCHEMA, HEADLINE_MAX, MAX_WENT_WELL, toWorkoutAnalysis } from './output.ts';
import { ANALYSIS_SYSTEM_PROMPT } from './prompt.ts';

const OUTPUT = {
  headline: 'Rodaje clavado: suave de verdad',
  went_well: ['FC media 141 ppm, dentro de lo previsto', 'RPE 3, como tocaba'],
  improve: [],
  next_step: 'Mañana toca series: duerme pronto y come hidratos en la cena.',
};

const DONE: Workout = workout({
  date: '2026-10-27',
  status: 'completed',
  completed: { durationMin: 52, avgHr: 141, rpe: 3, feel: 4, notes: 'Piernas frescas', source: 'garmin' },
});
const PLANNED: Workout = workout({ date: '2026-10-27', sport: 'bike', title: 'Rodillo', status: 'planned' });
const TOMORROW: Workout = workout({ date: '2026-10-28', title: 'Series 5×1 km', intensity: 'threshold', status: 'planned' });

interface Harness {
  deps: AnalysisHttpDeps;
  usage: UsageRecorder;
  seen: ClaudeRequest[];
  saved: Map<UUID, WorkoutAnalysis>;
}

function memoryStore(saved: Map<UUID, WorkoutAnalysis>): AnalysisStore {
  return {
    getAnalysis: async (_userId, workoutId) => saved.get(workoutId) ?? null,
    upsertAnalysis: async (_userId, analysis) => {
      saved.set(analysis.workoutId, analysis);
      return analysis;
    },
  };
}

function harness(opts: { claude?: ClaudePort | null; response?: Partial<ClaudeResponse> | Error; consentAt?: string | null; used?: number } = {}): Harness {
  const state = emptyState();
  state.workouts.push(DONE, PLANNED, TOMORROW);
  state.checkins.push({
    userId: USER,
    date: '2026-10-27',
    sleepQuality: null,
    sleepHours: 7,
    fatigue: null,
    soreness: null,
    stress: null,
    motivation: null,
    habits: { alcohol: true, niggle: false },
    notes: null,
  });
  const seen: ClaudeRequest[] = [];
  const saved = new Map<UUID, WorkoutAnalysis>();
  const usage = usageRecorder({ consentAt: opts.consentAt, used: opts.used, functionName: 'analysis' });
  const claude = opts.claude === undefined ? claudeReturning(opts.response ?? { text: JSON.stringify(OUTPUT) }, seen) : opts.claude;
  return {
    deps: {
      authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? USER : null),
      reader: fakeStore(state),
      analyses: memoryStore(saved),
      usage: usage.store,
      claude,
      now: fixedNow,
      logger: silentLogger,
    },
    usage,
    seen,
    saved,
  };
}

const post = (body: unknown, auth = 'Bearer good'): Request =>
  new Request('https://x.supabase.co/functions/v1/analysis', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const ask = { workoutId: DONE.id, date: DONE.date };

test('analysis: analyses a completed session, stores it and reuses it until refresh', async () => {
  const h = harness();
  const res = await handleAnalysisHttp(post(ask), h.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as WorkoutAnalysis;
  assert.equal(body.headline, OUTPUT.headline);
  assert.deepEqual(body.wentWell, OUTPUT.went_well);
  assert.equal(body.engine, 'ai');
  assert.equal(h.saved.get(DONE.id)?.headline, OUTPUT.headline);
  assert.equal(h.seen.length, 1);
  assert.equal(h.seen[0]?.system, ANALYSIS_SYSTEM_PROMPT);
  assert.equal(h.seen[0]?.schema, ANALYSIS_OUTPUT_JSON_SCHEMA);

  const again = await handleAnalysisHttp(post(ask), h.deps);
  assert.equal(again.status, 200);
  assert.equal(h.seen.length, 1, 'the stored analysis is returned without calling the AI');

  await handleAnalysisHttp(post({ ...ask, refresh: true }), h.deps);
  assert.equal(h.seen.length, 2, 'refresh asks again');
});

test('analysis: the prompt carries plan vs done, the notes, the journal answers and tomorrow', async () => {
  const h = harness();
  await handleAnalysisHttp(post(ask), h.deps);
  const message = h.seen[0]?.messages[0];
  assert.ok(message);
  const text = messageText(message);
  assert.match(text, /FC media 141 ppm/);
  assert.match(text, /Piernas frescas/);
  assert.match(text, /Bebió alcohol ayer: sí/);
  assert.match(text, /Tiene alguna molestia o dolor: no/);
  assert.match(text, /Series 5×1 km/);
  assert.doesNotMatch(text, /"fatigue":null/, 'unanswered scales are left out');
});

test('analysis: 401, 400, 404, planned sessions, consent, rate limit and AI failures', async () => {
  const h = harness();
  assert.equal((await handleAnalysisHttp(post(ask, 'Bearer bad'), h.deps)).status, 401);
  assert.equal((await handleAnalysisHttp(post({ workoutId: 'nope', date: DONE.date }), h.deps)).status, 400);
  assert.equal((await handleAnalysisHttp(post({ workoutId: DONE.id, date: '27/10/2026' }), h.deps)).status, 400);
  assert.equal((await handleAnalysisHttp(post({ ...ask, workoutId: '99999999-9999-4999-8999-999999999999' }), h.deps)).status, 404);
  assert.equal((await handleAnalysisHttp(post({ workoutId: PLANNED.id, date: PLANNED.date }), h.deps)).status, 400);
  assert.equal(h.seen.length, 0);

  const noConsent = await handleAnalysisHttp(post(ask), harness({ consentAt: null }).deps);
  assert.equal(noConsent.status, 403);
  assert.equal(((await noConsent.json()) as { message: string }).message, ANALYSIS_CONSENT_MESSAGE);

  assert.equal((await handleAnalysisHttp(post(ask), harness({ used: ANALYSIS_DAILY_LIMIT }).deps)).status, 429);
  assert.equal((await handleAnalysisHttp(post(ask), harness({ claude: null }).deps)).status, 503);
  const failing = harness({ response: new CoachAiError('timeout', 'tarde') });
  assert.equal((await handleAnalysisHttp(post(ask), failing.deps)).status, 503);
  const garbage = harness({ response: { text: '{"headline":""}' } });
  assert.equal((await handleAnalysisHttp(post(ask), garbage.deps)).status, 503);
  assert.equal(garbage.saved.size, 0, 'nothing is stored when the answer is unusable');
});

test('analysis output: plain short text, bounded lists, headline and next step required', () => {
  const a = toWorkoutAnalysis(
    {
      headline: `**${'Muy buena sesión '.repeat(10)}**`,
      went_well: ['- Uno', 'Dos', 'Tres', 'Cuatro', 7],
      improve: 'no es una lista',
      next_step: 'Mañana, suave 🙂',
    },
    DONE.id,
    '2026-10-27T10:00:00.000Z',
  );
  assert.ok(a.headline.length <= HEADLINE_MAX && !a.headline.includes('*'));
  assert.deepEqual(a.wentWell, ['Uno', 'Dos', 'Tres'].slice(0, MAX_WENT_WELL));
  assert.deepEqual(a.improve, []);
  assert.equal(a.nextStep, 'Mañana, suave');
  assert.throws(() => toWorkoutAnalysis({ headline: 'Bien', next_step: '' }, DONE.id, ''), CoachAiError);
});

test('analysis context: without check-in or tomorrow it says so', () => {
  const state = emptyState();
  const text = analysisMessage({ workout: DONE, profile: state.profiles[0]!, races: [], workouts: [DONE], checkin: null });
  assert.match(text, /No hizo el check-in esa mañana/);
  assert.match(text, /Mañana no tiene nada planificado/);
});

test('analysis context: what the watch file says reaches the model under completed.fromFile, only when analysed', () => {
  const state = emptyState();
  const analysed: Workout = {
    ...DONE,
    completed: { ...DONE.completed, decouplingPct: 6.2, hrDriftBpm: 7.6, normalizedPowerW: 212, analyzedAt: '2026-10-27T10:00:00.000Z' },
  };
  const text = analysisMessage({ workout: analysed, profile: state.profiles[0]!, races: [], workouts: [analysed], checkin: null });
  assert.match(text, /"fromFile":\{"decouplingPct":6\.2,"hrDriftBpm":7\.6,"normalizedPowerW":212\}/);
  const plain = analysisMessage({ workout: DONE, profile: state.profiles[0]!, races: [], workouts: [DONE], checkin: null });
  assert.doesNotMatch(plain, /fromFile/);
  const notMarked: Workout = { ...DONE, completed: { ...DONE.completed, decouplingPct: 6 } };
  assert.doesNotMatch(analysisMessage({ workout: notMarked, profile: state.profiles[0]!, races: [], workouts: [notMarked], checkin: null }), /fromFile/);
  assert.match(ANALYSIS_SYSTEM_PROMPT, /completed\.fromFile/);
});
