/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Briefing } from '@/domain/types';

import { BRIEFING_TIMEOUT_MS, briefingApi } from '../supabase/briefingApi';
import { createCtx } from '../supabase/base';
import { LOCAL_BRIEFING_DAYS, localBriefingsKey, readLocalBriefing, saveLocalBriefing } from '../supabase/localBriefings';
import { createSupabaseRepository } from '../supabase/SupabaseRepository';
import { chainArgs, fakeClient, type FakeCall } from './supabaseFake';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, aiCoachEnabled: true } };
});
const mockEnv = jest.requireMock<{ env: { aiCoachEnabled: boolean } }>('@/lib/env').env;

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

beforeEach(async () => {
  mockEnv.aiCoachEnabled = true;
  await AsyncStorage.clear();
});

const DATE = '2026-10-27';
const NOW = new Date(2026, 9, 27, 7, 0, 0);
const ISO = NOW.toISOString();

const PROFILE_ROW = {
  id: 'me',
  username: 'diego',
  display_name: 'Diego',
  avatar_url: null,
  sports: ['swim', 'bike', 'run'],
  level: 'intermediate',
  thresholds: {},
  availability: {},
  visibility: 'full',
  notification_prefs: {},
  timezone: 'Europe/Madrid',
  coach_notes: null,
  onboarded_at: ISO,
  created_at: ISO,
};

const WORKOUT_ROW = {
  id: 'w1',
  user_id: 'me',
  date: DATE,
  start_time: '07:30:00',
  sport: 'run',
  title: 'Rodaje suave',
  description: null,
  duration_min: 50,
  distance_m: null,
  intensity: 'endurance',
  tss: null,
  steps: [],
  status: 'planned',
  completed: null,
  source: 'rules',
  is_key: false,
  joint_session_id: null,
  external_id: null,
  created_at: ISO,
  updated_at: ISO,
};

const METRICS_ROW = {
  user_id: 'me',
  date: DATE,
  source: 'garmin',
  hrv_ms: '68.0',
  resting_hr: 49,
  sleep_hours: 7.33,
  sleep_score: 82,
  body_battery: 74,
  training_readiness: null,
  vo2max: null,
  steps: null,
  stress_avg: null,
  training_status: null,
  sleep_deep_min: 80,
  sleep_light_min: 250,
  sleep_rem_min: 110,
  sleep_awake_min: 20,
  sleep_start: null,
  sleep_end: null,
};

const AI_BRIEFING: Briefing = {
  date: DATE,
  headline: 'Hoy rodaje suave',
  sleepVerdict: 'good',
  sleepSummary: 'Buena noche.',
  script: 'Buenos días, Diego.',
  focus: 'Suave de verdad.',
  sleep: null,
  engine: 'ai',
  createdAt: ISO,
};

type Invoke = jest.Mock<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>;

function setup(rows: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    profiles: { data: PROFILE_ROW, error: null },
    workouts: { data: [WORKOUT_ROW], error: null },
    races: { data: [], error: null },
    daily_metrics: { data: [METRICS_ROW], error: null },
    briefings: (rows.briefingsResult as { data: unknown; error: unknown } | undefined) ?? { data: rows.briefings ?? null, error: null },
  });
  const invoke = client.functions.invoke as unknown as Invoke;
  const repo = createSupabaseRepository({ client, now: () => NOW });
  return { repo, invoke, calls, client };
}

function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', message: 'non-2xx', context: new Response(JSON.stringify(body), { status }) };
}

function targets(calls: FakeCall[]): string[] {
  return calls.map((c) => c.target);
}

describe('Supabase getBriefing', () => {
  it("selects the athlete's row of the date", async () => {
    const row = {
      user_id: 'me',
      date: DATE,
      headline: 'Hola',
      sleep_verdict: 'great',
      sleep_summary: 'Noche excelente.',
      script: 'Texto',
      focus: 'Foco',
      sleep: { hours: 8 },
      model: 'claude-opus-5-5',
      created_at: ISO,
    };
    const { repo, calls } = setup({ briefings: row });
    const briefing = await repo.getBriefing(DATE);
    expect(briefing).toMatchObject({ date: DATE, headline: 'Hola', sleepVerdict: 'great', engine: 'ai', createdAt: ISO });
    expect(briefing?.sleep?.hours).toBe(8);
    const call = calls.find((c) => c.target === 'briefings');
    expect(call?.chain.filter(([m]) => m === 'eq').map(([, args]) => args)).toEqual([
      ['user_id', 'me'],
      ['date', DATE],
    ]);
  });

  it('returns null without a row and rejects invalid dates', async () => {
    const { repo } = setup();
    expect(await repo.getBriefing(DATE)).toBeNull();
    await expect(repo.getBriefing('27/10/2026')).rejects.toMatchObject({ code: 'validation' });
  });

  it('treats a database without the briefings table as "not generated" but surfaces other errors', async () => {
    const missing = fakeClient({ briefings: { data: null, error: { code: 'PGRST205', message: 'Could not find the table', details: '', hint: '' } } });
    expect(await createSupabaseRepository({ client: missing.client, now: () => NOW }).getBriefing(DATE)).toBeNull();
    const denied = fakeClient({ briefings: { data: null, error: { code: '42501', message: 'permission denied', details: '', hint: '' } } });
    await expect(createSupabaseRepository({ client: denied.client, now: () => NOW }).getBriefing(DATE)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('Supabase listMetrics before the v2 migration', () => {
  it('retries without the sleep columns when they do not exist yet', async () => {
    let attempt = 0;
    const responses = {};
    Object.defineProperty(responses, 'daily_metrics', {
      get: () => {
        attempt += 1;
        return attempt === 1
          ? { data: null, error: { code: '42703', message: 'column daily_metrics.sleep_deep_min does not exist', details: '', hint: '' } }
          : { data: [{ ...METRICS_ROW, sleep_deep_min: undefined }], error: null };
      },
    });
    const { client, calls } = fakeClient(responses);
    const metrics = await createSupabaseRepository({ client, now: () => NOW }).listMetrics({ from: DATE, to: DATE });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ hrvMs: 68, sleepDeepMin: null });
    const selects = calls.filter((c) => c.target === 'daily_metrics').map((c) => String(chainArgs(c, 'select')?.[0]));
    expect(selects[0]).toContain('sleep_deep_min');
    expect(selects[1]).not.toContain('sleep_deep_min');
  });
});

describe('Supabase generateBriefing', () => {
  it('composes the local briefing when the AI is off (no edge function)', async () => {
    mockEnv.aiCoachEnabled = false;
    const { repo, invoke, calls } = setup();
    const briefing = await repo.generateBriefing(DATE);
    expect(invoke).not.toHaveBeenCalled();
    expect(briefing).toMatchObject({ engine: 'rules', date: DATE, sleepVerdict: 'good', createdAt: ISO });
    expect(briefing.headline).toBe("Dormiste 7 h 20' · Hoy rodaje suave 50'");
    expect(briefing.script).toMatch(/^Buenos días, Diego\./);
    const metricsCall = calls.find((c) => c.target === 'daily_metrics');
    expect(chainArgs(metricsCall, 'gte')).toEqual(['date', '2026-10-20']);
    expect(String(chainArgs(metricsCall, 'select')?.[0])).toContain('sleep_deep_min');
    expect(chainArgs(calls.find((c) => c.target === 'workouts'), 'lte')).toEqual(['date', '2026-10-28']);
  });

  it('invokes the briefing function and returns its briefing', async () => {
    const { repo, invoke } = setup();
    invoke.mockResolvedValueOnce({ data: AI_BRIEFING, error: null });
    const briefing = await repo.generateBriefing(DATE, { refresh: true });
    expect(briefing).toEqual(AI_BRIEFING);
    expect(invoke).toHaveBeenCalledWith('briefing', { body: { date: DATE, refresh: true }, timeout: BRIEFING_TIMEOUT_MS });
  });

  it.each([
    ['AI unavailable', httpError(503, { error: 'ai_unavailable' })],
    ['no consent', httpError(403, { error: 'consent_required' })],
    ['rate limited', httpError(429, { error: 'rate_limited' })],
    ['server error', httpError(500, { error: 'internal' })],
    ['not deployed', httpError(404, {})],
    ['relay error', { name: 'FunctionsRelayError', message: 'relay', context: {} }],
    ['fetch timeout', { name: 'FunctionsFetchError', message: 'x', context: { name: 'AbortError', message: 'Aborted' } }],
    ['unknown error', { name: 'Weird' }],
  ])('falls back to the local template: %s', async (_label, error) => {
    const { repo, invoke, calls } = setup();
    invoke.mockResolvedValueOnce({ data: null, error });
    const briefing = await repo.generateBriefing(DATE);
    expect(briefing.engine).toBe('rules');
    expect(targets(calls)).toEqual(expect.arrayContaining(['profiles', 'daily_metrics', 'workouts', 'races']));
  });

  it('falls back when the response is unusable or invoke throws an abort', async () => {
    const { repo, invoke } = setup();
    invoke.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect((await repo.generateBriefing(DATE)).engine).toBe('rules');
    invoke.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    expect((await repo.generateBriefing(DATE)).engine).toBe('rules');
  });

  it('throws on expired sessions, offline and bad requests', async () => {
    const { repo, invoke } = setup();
    invoke.mockResolvedValueOnce({ data: null, error: httpError(401, {}) });
    await expect(repo.generateBriefing(DATE)).rejects.toMatchObject({ code: 'not_authenticated' });
    invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'x', context: new TypeError('Network request failed') } });
    await expect(repo.generateBriefing(DATE)).rejects.toMatchObject({ code: 'network' });
    invoke.mockResolvedValueOnce({ data: null, error: httpError(400, { error: 'bad_request', message: 'Fecha inválida' }) });
    await expect(repo.generateBriefing(DATE)).rejects.toMatchObject({ code: 'validation', message: 'Fecha inválida' });
    invoke.mockResolvedValueOnce({ data: null, error: httpError(403, { error: 'forbidden' }) });
    await expect(repo.generateBriefing(DATE)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(repo.generateBriefing('mañana')).rejects.toMatchObject({ code: 'validation' });
  });

  it('gives up on a function that never answers', async () => {
    jest.useFakeTimers();
    try {
      const { client } = fakeClient({});
      (client.functions.invoke as unknown as Invoke).mockReturnValue(new Promise(() => undefined));
      const local = { getMyProfile: async () => null, listMetrics: async () => [], listWorkouts: async () => [], listRaces: async () => [] };
      const api = briefingApi({ ctx: createCtx(client, () => NOW), repo: local, timeoutMs: 1_000 });
      const pending = api.generateBriefing(DATE);
      await jest.advanceTimersByTimeAsync(3_100);
      const briefing = await pending;
      expect(briefing).toMatchObject({ engine: 'rules', sleep: null, headline: 'Hoy descanso' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Supabase local briefing kept on the device', () => {
  const SERVER_ROW = {
    user_id: 'me',
    date: DATE,
    headline: 'Informe del servidor',
    sleep_verdict: 'good',
    sleep_summary: 'Buena noche.',
    script: 'Texto del servidor.',
    focus: 'Foco.',
    sleep: null,
    model: 'llama',
    created_at: ISO,
  };

  it('keeps a fallback briefing so getBriefing still returns it on refetch', async () => {
    const { repo, invoke } = setup();
    invoke.mockResolvedValueOnce({ data: null, error: httpError(503, { error: 'ai_unavailable' }) });
    const generated = await repo.generateBriefing(DATE);
    expect(generated.engine).toBe('rules');
    expect(await repo.getBriefing(DATE)).toEqual(generated);
    expect(await repo.getBriefing('2026-10-26')).toBeNull();
  });

  it('keeps the local briefing with the AI off too, per user', async () => {
    mockEnv.aiCoachEnabled = false;
    const { repo } = setup();
    const generated = await repo.generateBriefing(DATE);
    expect(await readLocalBriefing('me', DATE)).toEqual(generated);
    expect(await readLocalBriefing('someone-else', DATE)).toBeNull();
  });

  it('lets the server row win, and a later AI generation drops the device copy', async () => {
    const fallback = setup();
    fallback.invoke.mockResolvedValueOnce({ data: null, error: httpError(429, { error: 'rate_limited' }) });
    await fallback.repo.generateBriefing(DATE);

    const withRow = setup({ briefings: SERVER_ROW });
    expect(await withRow.repo.getBriefing(DATE)).toMatchObject({ headline: 'Informe del servidor', engine: 'ai' });

    const ai = setup();
    ai.invoke.mockResolvedValueOnce({ data: { ...AI_BRIEFING, headline: 'Ahora sí, con IA' }, error: null });
    expect((await ai.repo.generateBriefing(DATE, { refresh: true })).engine).toBe('ai');
    expect(await readLocalBriefing('me', DATE)).toBeNull();
  });

  it.each([
    ['timeout', { name: 'FunctionsFetchError', message: 'x', context: { name: 'AbortError' } }],
    ['rate limited', httpError(429, { error: 'rate_limited' })],
    ['server error', httpError(500, { error: 'internal' })],
  ])('a failed refresh (%s) keeps the stored AI briefing instead of the template', async (_label, error) => {
    const { repo, invoke } = setup({ briefings: SERVER_ROW });
    invoke.mockResolvedValueOnce({ data: null, error });
    const kept = await repo.generateBriefing(DATE, { refresh: true });
    expect(kept).toMatchObject({ headline: 'Informe del servidor', engine: 'ai' });
    expect(await readLocalBriefing('me', DATE)).toBeNull();
  });

  it('a failed refresh without a stored briefing (or unreadable) still falls back to the template', async () => {
    const empty = setup();
    empty.invoke.mockResolvedValueOnce({ data: null, error: httpError(503, { error: 'ai_unavailable' }) });
    expect((await empty.repo.generateBriefing(DATE, { refresh: true })).engine).toBe('rules');

    const denied = { data: null, error: { code: '42501', message: 'permission denied', details: '', hint: '' } };
    const unreadable = setup({ briefingsResult: denied });
    unreadable.invoke.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect((await unreadable.repo.generateBriefing(DATE, { refresh: true })).engine).toBe('rules');
  });

  it('serves the device copy when offline and rethrows otherwise', async () => {
    const generated = await setup().repo.generateBriefing(DATE).catch(() => null);
    expect(generated).not.toBeNull();
    const offline = { data: null, error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' } };
    expect(await setup({ briefingsResult: offline }).repo.getBriefing(DATE)).toMatchObject({ engine: 'rules', date: DATE });
    await expect(setup({ briefingsResult: offline }).repo.getBriefing('2026-10-26')).rejects.toMatchObject({ code: 'network' });
  });

  it('keeps only the last 7 days and ignores corrupt entries', async () => {
    const base = { ...AI_BRIEFING, engine: 'rules' as const };
    const dates = ['2026-10-18', '2026-10-20', '2026-10-21', '2026-10-27'];
    for (const date of dates) await saveLocalBriefing('me', { ...base, date });
    const stored = JSON.parse((await AsyncStorage.getItem(localBriefingsKey('me'))) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['2026-10-21', '2026-10-27']);
    expect(LOCAL_BRIEFING_DAYS).toBe(7);
    await AsyncStorage.setItem(localBriefingsKey('me'), JSON.stringify({ [DATE]: { headline: '' }, '2026-10-26': { ...base, date: '2026-10-20' } }));
    expect(await readLocalBriefing('me', DATE)).toBeNull();
    expect(await readLocalBriefing('me', '2026-10-26')).toBeNull();
    await AsyncStorage.setItem(localBriefingsKey('me'), 'not json');
    expect(await readLocalBriefing('me', DATE)).toBeNull();
  });

  it('is removed on sign-out', async () => {
    mockEnv.aiCoachEnabled = false;
    const { repo, client } = setup();
    Object.assign(client.auth, { signOut: jest.fn(async () => ({ error: null })) });
    await repo.generateBriefing(DATE);
    expect(await AsyncStorage.getItem(localBriefingsKey('me'))).not.toBeNull();
    await repo.auth.signOut();
    expect(await AsyncStorage.getItem(localBriefingsKey('me'))).toBeNull();
  });
});
