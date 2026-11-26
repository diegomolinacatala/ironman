import assert from 'node:assert/strict';
import test from 'node:test';
import { base64UrlEncode } from '../crypto.ts';
import { createGarminApi, GARMIN_TOKEN_PATH } from '../garmin/api.ts';
import { encryptApiKey, EXPIRED_MESSAGE } from '../garmin/credentials.ts';
import type { CredentialStore, GarminCredential } from '../garmin/credentials.ts';
import { pullTodaySleep, SLEEP_PATH } from '../garmin/sleep-pull.ts';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, USER } from '../testing/fakes.ts';
import type { UUID } from '../types.ts';
import { handleMorningHttp } from './http.ts';
import { dueAtIso, localWakes, planCandidate } from './plan.ts';
import type { NightRow, WakeCandidate } from './plan.ts';
import { nightsOf, toCandidate } from './rows.ts';
import { checkDue, runWakeSweep } from './sweep.ts';
import type { MorningStore, SendBriefingInput, SleepPuller } from './sweep.ts';

const TZ = 'Europe/Madrid';
/** Thursday. Madrid is UTC+1 in November. */
const TODAY = '2026-11-26';
const NOW = new Date('2026-11-26T06:20:00.000Z'); // 07:20 in Madrid

/** A night ending at `hhmm` Madrid time (UTC+1) on `date`. */
function night(date: string, hhmm: string, source = 'garmin'): NightRow {
  const [h, m] = hhmm.split(':').map(Number);
  const end = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), (h ?? 0) - 1, m ?? 0));
  const start = new Date(end.getTime() - 7.5 * 3_600_000);
  return { date, source, start: start.toISOString(), end: end.toISOString() };
}

/** Weekdays 9–25 Nov: wake-ups 06:40 (and 07:10 on Mondays); weekends at 08:30. */
function history(): NightRow[] {
  const rows: NightRow[] = [];
  for (let day = 9; day <= 25; day += 1) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    if (weekday === 0 || weekday === 6) rows.push(night(date, '08:30'));
    else rows.push(night(date, weekday === 1 ? '07:10' : '06:40'));
  }
  return rows;
}

function candidate(overrides: Partial<WakeCandidate> = {}): WakeCandidate {
  return {
    userId: USER,
    timezone: TZ,
    today: TODAY,
    nowMinutes: 7 * 60 + 20,
    prefs: { morningSummary: true, morningTime: '07:30', morningMode: 'wake', wakeDelayMin: 15 },
    garmin: false,
    lastCheckAt: null,
    nights: history(),
    ...overrides,
  };
}

test('localWakes: one wake-up per local date, Garmin over Apple Salud', () => {
  const wakes = localWakes([night('2026-11-25', '06:40', 'healthkit'), night('2026-11-25', '06:45', 'garmin'), { date: '2026-11-24', source: 'garmin', start: null, end: null }], TZ);
  assert.deepEqual(
    wakes.map((w) => [w.date, w.minutes]),
    [['2026-11-25', 6 * 60 + 45]],
  );
});

test('planCandidate learns the weekday window (earliest −30, latest +60) and looks inside it', () => {
  const plan = planCandidate(candidate({ nowMinutes: 6 * 60 + 20 }));
  assert.equal(plan.source, 'learned');
  assert.deepEqual(plan.window, { from: 6 * 60 + 10, to: 8 * 60 + 10 });
  assert.equal(plan.fallbackAt, 8 * 60 + 10, 'window end is later than the fixed 07:30');
  assert.deepEqual(plan.decision, { action: 'check' });
  assert.deepEqual(planCandidate(candidate({ nowMinutes: 5 * 60 })).decision, { action: 'wait', reason: 'before_window' });
});

test('planCandidate sends the delay after the wake-up, at once when that moment has passed', () => {
  const awake = candidate({ nights: [...history(), night(TODAY, '06:35')] });
  assert.deepEqual(planCandidate({ ...awake, nowMinutes: 6 * 60 + 45 }).decision, { action: 'wait', reason: 'due_later' });
  const plan = planCandidate({ ...awake, nowMinutes: 6 * 60 + 50 });
  assert.deepEqual(plan.decision, { action: 'send', reason: 'wake', dueMinutes: 6 * 60 + 50 });
  assert.equal(plan.wakeIso, '2026-11-26T05:35:00.000Z');
  assert.equal(dueAtIso(awake, plan), '2026-11-26T05:50:00.000Z');
  const delayed = planCandidate({ ...awake, prefs: { ...awake.prefs, wakeDelayMin: 30 }, nowMinutes: 6 * 60 + 50 });
  assert.deepEqual(delayed.decision, { action: 'wait', reason: 'due_later' });
});

test('planCandidate falls back at the window end (or the fixed time if later), held while asleep', () => {
  const fallback = planCandidate(candidate({ nowMinutes: 8 * 60 + 10 }));
  assert.deepEqual(fallback.decision, { action: 'send', reason: 'fallback', dueMinutes: 8 * 60 + 10 });
  assert.equal(dueAtIso(candidate(), fallback), '2026-11-26T07:10:00.000Z');
  const lateFixed = planCandidate(candidate({ prefs: { morningSummary: true, morningTime: '09:00', morningMode: 'wake' }, nowMinutes: 8 * 60 + 30 }));
  assert.equal(lateFixed.fallbackAt, 9 * 60);
  assert.deepEqual(lateFixed.decision, { action: 'check' });
  const asleep = candidate({ nights: [...history(), { date: TODAY, source: 'garmin', start: '2026-11-25T23:30:00.000Z', end: null }] });
  assert.deepEqual(planCandidate({ ...asleep, nowMinutes: 8 * 60 + 30 }).decision, { action: 'wait', reason: 'asleep' });
  assert.deepEqual(planCandidate({ ...asleep, nowMinutes: 11 * 60 + 10 }).decision, { action: 'wait', reason: 'too_late' });
  assert.deepEqual(planCandidate(candidate({ nowMinutes: 11 * 60 + 10 })).decision, { action: 'wait', reason: 'too_late' });
});

test('planCandidate: the athlete\'s own window wins; without history, two hours before the fixed time', () => {
  const own = planCandidate(candidate({ prefs: { morningSummary: true, morningTime: '07:30', morningMode: 'wake', wakeWindow: { from: '05:00', to: '06:00' } } }));
  assert.equal(own.source, 'override');
  assert.deepEqual(own.window, { from: 300, to: 360 });
  assert.equal(own.fallbackAt, 7 * 60 + 30, 'the fixed time is later than the window end');
  const fresh = planCandidate(candidate({ nights: [] }));
  assert.equal(fresh.source, 'default');
  assert.deepEqual(fresh.window, { from: 5 * 60 + 30, to: 7 * 60 + 30 });
});

test('planCandidate uses the weekend window on Saturdays', () => {
  const saturday = candidate({ today: '2026-11-28' });
  assert.deepEqual(planCandidate(saturday).window, { from: 8 * 60, to: 9 * 60 + 30 });
  assert.deepEqual(planCandidate({ ...saturday, nowMinutes: 7 * 60 + 30 }).decision, { action: 'wait', reason: 'before_window' });
  assert.deepEqual(planCandidate({ ...saturday, nowMinutes: 8 * 60 + 15 }).decision, { action: 'check' });
});

interface Recorder {
  store: MorningStore;
  sent: SendBriefingInput[];
  skipped: string[];
  checks: string[];
}

function recorder(candidates: WakeCandidate[], opts: { refuse?: UUID[]; failSend?: UUID } = {}): Recorder {
  const rec: Recorder = { sent: [], skipped: [], checks: [], store: undefined as unknown as MorningStore };
  rec.store = {
    listCandidates: async () => candidates,
    sendBriefing: async (input) => {
      if (input.userId === opts.failSend) throw new Error('db down');
      if (opts.refuse?.includes(input.userId)) return false;
      rec.sent.push(input);
      return true;
    },
    skipBriefing: async (userId) => {
      rec.skipped.push(userId);
      return true;
    },
    recordCheck: async (userId) => {
      rec.checks.push(userId);
    },
  };
  return rec;
}

const sweepNow = (): Date => NOW;

test('runWakeSweep: pulls Garmin inside the window, sends once the wake-up is due', async () => {
  const pulls: string[] = [];
  const pull: SleepPuller = async (userId) => {
    pulls.push(userId);
    return { start: '2026-11-25T22:05:00.000Z', end: '2026-11-26T05:50:00.000Z' }; // woke 06:50 → due 07:05
  };
  const garmin = candidate({ userId: 'g1', garmin: true });
  const rec = recorder([garmin]);
  const summary = await runWakeSweep({ store: rec.store, pullSleep: pull, now: sweepNow, logger: silentLogger });
  assert.deepEqual(pulls, ['g1']);
  assert.deepEqual(rec.checks, ['g1']);
  assert.deepEqual(rec.sent, [{ userId: 'g1', date: TODAY, reason: 'wake', sleepEnd: '2026-11-26T05:50:00.000Z', dueAt: '2026-11-26T06:05:00.000Z' }]);
  assert.deepEqual(summary, { candidates: 1, sent: 1, fallbacks: 0, checked: 1, waiting: 0, late: 0, failed: 0, skipped: 0 });
});

test('runWakeSweep: at most one Garmin pull every 10 min; others just wait for the app', async () => {
  let pulls = 0;
  const pull: SleepPuller = async () => {
    pulls += 1;
    return null;
  };
  const recent = candidate({ userId: 'g2', garmin: true, lastCheckAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
  const health = candidate({ userId: 'h1' });
  const due = candidate({ userId: 'g3', garmin: true, lastCheckAt: new Date(NOW.getTime() - 9.5 * 60_000).toISOString() });
  const rec = recorder([recent, health, due]);
  const summary = await runWakeSweep({ store: rec.store, pullSleep: pull, now: sweepNow, logger: silentLogger });
  assert.equal(pulls, 1, 'only g3 (≈10 min since its last pull)');
  assert.deepEqual(rec.checks, ['g3']);
  assert.equal(summary.waiting, 3);
  assert.deepEqual(rec.sent, []);
  assert.equal(checkDue(null, NOW), true);
});

test('runWakeSweep: fallback, already settled, too late, failures and a broken pull', async () => {
  const fallback = candidate({ userId: 'f1', nowMinutes: 8 * 60 + 15 });
  const settled = candidate({ userId: 'f2', nowMinutes: 8 * 60 + 15 });
  const late = candidate({ userId: 'l1', nowMinutes: 12 * 60 });
  const broken = candidate({ userId: 'x1', nowMinutes: 8 * 60 + 15 });
  const pulling = candidate({ userId: 'p1', garmin: true });
  const rec = recorder([fallback, settled, late, broken, pulling], { refuse: ['f2'], failSend: 'x1' });
  const pull: SleepPuller = async () => {
    throw new Error('garmin down');
  };
  const summary = await runWakeSweep({ store: rec.store, pullSleep: pull, now: sweepNow, logger: silentLogger });
  assert.deepEqual(rec.sent.map((s) => [s.userId, s.reason, s.sleepEnd]), [['f1', 'fallback', null]]);
  assert.deepEqual(rec.skipped, ['l1']);
  assert.deepEqual(summary, { candidates: 5, sent: 0, fallbacks: 1, checked: 1, waiting: 1, late: 1, failed: 1, skipped: 0 });
});

test('runWakeSweep: without Garmin configured on the server it never pulls', async () => {
  const rec = recorder([candidate({ garmin: true })]);
  const summary = await runWakeSweep({ store: rec.store, pullSleep: null, now: sweepNow, logger: silentLogger });
  assert.equal(summary.checked, 0);
  assert.deepEqual(rec.checks, []);
});

const post = (body: unknown, headers: Record<string, string> = { apikey: 'sb_secret_x' }): Request =>
  new Request('https://x/functions/v1/morning', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('handleMorningHttp: secret key, POST {action: sweep}', async () => {
  const deps = { store: recorder([]).store, pullSleep: null, now: sweepNow, logger: silentLogger, secretKeys: ['sb_secret_x'] };
  assert.equal((await handleMorningHttp(new Request('https://x/morning'), deps)).status, 405);
  assert.equal((await handleMorningHttp(post({ action: 'sweep' }, {}), deps)).status, 401);
  assert.equal((await handleMorningHttp(post({ action: 'other' }), deps)).status, 400);
  assert.equal((await handleMorningHttp(post({ action: 'sweep' }), { ...deps, secretKeys: [] })).status, 500);
  const ok = await handleMorningHttp(post({ action: 'sweep' }), deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { candidates: 0, sent: 0, fallbacks: 0, checked: 0, waiting: 0, late: 0, failed: 0, skipped: 0 });
  const failing = { ...deps, store: { ...deps.store, listCandidates: async () => Promise.reject(new Error('db')) } };
  assert.equal((await handleMorningHttp(post({ action: 'sweep' }), failing)).status, 500);
});

const part = (o: unknown): string => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
const JWT = `${part({ alg: 'ES256' })}.${part({ exp: 1893456000 })}.sig`;
const KEY = 'GARMIN-PERSONAL-KEY-0123456789';
const SECRET = 'server-side-garmin-key-secret-0001';

const SLEEP_TODAY = {
  dailySleepDTO: {
    calendarDate: TODAY,
    sleepTimeSeconds: 27000,
    sleepStartTimestampGMT: Date.UTC(2026, 10, 25, 22, 5),
    sleepEndTimestampGMT: Date.UTC(2026, 10, 26, 5, 50),
  },
};

function garminFetch(seen: string[], status = 200) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    seen.push(url);
    if (url.endsWith(GARMIN_TOKEN_PATH)) {
      return (init.headers as Record<string, string>).Authorization === `ApiKey ${KEY}` ? new Response(JWT) : new Response('', { status: 401 });
    }
    if (url.includes(SLEEP_PATH)) return status === 200 ? Response.json(SLEEP_TODAY) : new Response('', { status });
    return new Response('', { status: 404 });
  };
}

async function credentials(state: GarminCredential['state'] = 'connected', keyExpiresAt: string | null = null) {
  const rec = { current: { userId: USER, ciphertext: await encryptApiKey(KEY, SECRET, USER), keyExpiresAt, state, lastSyncAt: null, lastError: null } as GarminCredential };
  const store: Pick<CredentialStore, 'getCredential' | 'updateCredentialState'> = {
    getCredential: async () => rec.current,
    updateCredentialState: async (_u, v) => {
      rec.current = { ...rec.current, state: v.state, lastError: v.lastError };
    },
  };
  return { rec, store };
}

test('pullTodaySleep: two Garmin calls, today\'s night stored as Garmin metrics', async () => {
  const seen: string[] = [];
  const state = emptyState();
  const { store } = await credentials();
  const api = createGarminApi(garminFetch(seen), 'https://garmin.test');
  const night = await pullTodaySleep({ api, store: fakeStore(state), credentials: store, keySecret: SECRET, now: sweepNow, logger: silentLogger }, USER, TZ, TODAY);
  assert.deepEqual(night, { start: '2026-11-25T22:05:00.000Z', end: '2026-11-26T05:50:00.000Z' });
  assert.equal(seen.length, 2);
  assert.ok(seen[1]?.includes(`startDate=${TODAY}`) && seen[1]?.includes(`endDate=${TODAY}`));
  assert.equal(state.metricUpserts[0]?.source, 'garmin');
  assert.equal(state.metricUpserts[0]?.rows[0]?.sleepEnd, '2026-11-26T05:50:00.000Z');
});

test('pullTodaySleep: expired keys are marked, disconnected or expired ones are not called', async () => {
  const seen: string[] = [];
  const api = createGarminApi(garminFetch(seen, 401), 'https://garmin.test');
  const { rec, store } = await credentials();
  const deps = { api, store: fakeStore(emptyState()), credentials: store, keySecret: SECRET, now: sweepNow, logger: silentLogger };
  assert.equal(await pullTodaySleep(deps, USER, TZ, TODAY), null);
  assert.equal(rec.current.state, 'expired');
  assert.equal(rec.current.lastError, EXPIRED_MESSAGE);
  seen.length = 0;
  const disconnected = await credentials('disconnected');
  assert.equal(await pullTodaySleep({ ...deps, credentials: disconnected.store }, USER, TZ, TODAY), null);
  const byDate = await credentials('connected', '2026-11-01');
  assert.equal(await pullTodaySleep({ ...deps, credentials: byDate.store }, USER, TZ, TODAY), null);
  assert.deepEqual(seen, []);
});

test('morning store parses candidates defensively', () => {
  assert.deepEqual(nightsOf([{ date: '2026-11-25', source: 'garmin', start: null, end: '2026-11-25T05:40:00+00:00' }, { source: 'garmin' }, 'x']), [
    { date: '2026-11-25', source: 'garmin', start: null, end: '2026-11-25T05:40:00+00:00' },
  ]);
  assert.deepEqual(nightsOf(null), []);
  const parsed = toCandidate({
    user_id: USER,
    timezone: 'Europe/Madrid',
    local_date: '2026-11-26',
    local_minutes: 440,
    prefs: { morningMode: 'wake' },
    garmin: true,
    last_check_at: null,
    nights: [],
  });
  assert.equal(parsed?.today, TODAY);
  assert.equal(parsed?.nowMinutes, 440);
  assert.equal(parsed?.garmin, true);
  assert.equal(toCandidate({ user_id: USER }), null);
});
