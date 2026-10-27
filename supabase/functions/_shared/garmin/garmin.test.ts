import assert from 'node:assert/strict';
import test from 'node:test';
import { base64UrlEncode, decryptSecret } from '../crypto.ts';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, fixedNow, USER, workout } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import { createGarminApi, GARMIN_TOKEN_PATH, GarminApiError } from './api.ts';
import type { GarminApi } from './api.ts';
import { cipherContext, EXPIRED_MESSAGE, syncWithCredential } from './credentials.ts';
import type { CredentialStore, GarminCredential } from './credentials.ts';
import { handleGarminHttp } from './http.ts';
import type { GarminHttpDeps } from './http.ts';
import { mergeDayParts, parseActivities, parseBodyBattery, parseDailySummaries, parseHrv, parseSleepSummaries } from './parse.ts';
import { garminSport } from './sports.ts';
import { FIRST_SYNC_DAYS, planActivityImport, SYNC_DAYS, syncGarminUser, toMetricRows } from './sync.ts';

const part = (o: unknown): string => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
const JWT = `${part({ alg: 'ES256' })}.${part({ exp: 1893456000, sub: 'garmin-user' })}.sig`;
const KEY = 'GARMIN-PERSONAL-KEY-0123456789';
const SECRET = 'server-side-garmin-key-secret-0001';

// Fixtures shaped after Garmin Connect web / the official Personal API client endpoints.
const FIXTURES = {
  dailies: { data: [{ calendarDate: '2026-10-23', totalSteps: 11234, restingHeartRate: 48, averageStressLevel: 31, bodyBatteryHighestValue: 82 }, { calendarDate: '2026-10-24', movement: { steps: 4200 }, heartRate: { restingValue: 50 } }] },
  sleep: [{ dailySleepDTO: { calendarDate: '2026-10-24', sleepTimeSeconds: 25200, sleepScores: { overall: { value: 81 } } }, restingHeartRate: 47, avgOvernightHrv: 63 }],
  hrv: { hrvSummaries: [{ calendarDate: '2026-10-23', lastNightAvg: 59, weeklyAvg: 61, status: 'BALANCED' }, { calendarDate: '2026-10-24', lastNightAvg: 62 }] },
  bodyBattery: [{ date: '2026-10-24', charged: 60, drained: 40, bodyBatteryValuesArray: [[1761292800000, 35], [1761300000000, 'MEASURED', 88, 2.0], [1761310000000, 70]] }],
  activities: [
    { activityId: 9001, activityName: 'Rodaje matinal', startTimeLocal: '2026-10-24 08:05:00', activityType: { typeKey: 'running' }, duration: 3120.5, distance: 9800.2, averageHR: 148.6, trainingStressScore: 55.2 },
    { activityId: 9002, activityName: 'Pádel', startTimeLocal: '2026-10-23 19:00:00', activityType: { typeKey: 'padel' }, duration: 5400 },
    { activityId: 9003, activityName: 'Paseo', startTimeLocal: '2026-10-23 12:00:00', activityType: { typeKey: 'walking' }, duration: 1800 },
    { activityId: 9004, startTimeGMT: '2026-10-22 17:00:00', activityType: { typeKey: 'lap_swimming' }, duration: 2700, distance: 2000 },
    { activityId: 'bad', startTimeLocal: '2026-10-22 10:00:00', activityType: { typeKey: 'running' }, duration: 100 },
  ],
};

test('sport mapping covers triathlon, racket and team sports', () => {
  assert.equal(garminSport('trail_running'), 'run');
  assert.equal(garminSport('virtual_ride'), 'bike');
  assert.equal(garminSport('e_bike_mountain'), 'bike');
  assert.equal(garminSport('open_water_swimming'), 'swim');
  assert.equal(garminSport('multi_sport'), 'brick');
  assert.equal(garminSport('strength_training'), 'strength');
  assert.equal(garminSport('yoga'), 'mobility');
  assert.equal(garminSport('padel'), 'other');
  assert.equal(garminSport('tennis'), 'other');
  assert.equal(garminSport('soccer'), 'other');
  assert.equal(garminSport('indoor_rowing'), 'other');
  assert.equal(garminSport('walking'), null);
  assert.equal(garminSport('swimToBikeTransition'), null);
});

test('parsers read several payload shapes defensively', () => {
  const dailies = parseDailySummaries(FIXTURES.dailies);
  assert.deepEqual(dailies[0], { date: '2026-10-23', steps: 11234, restingHr: 48, stressAvg: 31, bodyBattery: 82 });
  assert.deepEqual(dailies[1], { date: '2026-10-24', steps: 4200, restingHr: 50 });
  assert.deepEqual(parseSleepSummaries(FIXTURES.sleep), [{ date: '2026-10-24', sleepHours: 7, sleepScore: 81, restingHr: 47, hrvMs: 63 }]);
  assert.deepEqual(parseSleepSummaries({ dailySleepDTO: { calendarDate: '2026-10-22', sleepTimeSeconds: 21600 } }), [{ date: '2026-10-22', sleepHours: 6 }]);
  assert.deepEqual(parseHrv(FIXTURES.hrv).map((h) => h.hrvMs), [59, 62]);
  assert.deepEqual(parseHrv({ hrvSummary: { calendarDate: '2026-10-24', lastNightAvg: 70 } }), [{ date: '2026-10-24', hrvMs: 70 }]);
  assert.deepEqual(parseBodyBattery(FIXTURES.bodyBattery), [{ date: '2026-10-24', bodyBattery: 88 }]);
  assert.deepEqual(parseDailySummaries(null), []);
  assert.deepEqual(parseDailySummaries({ data: [{ calendarDate: '2026-10-24', restingHeartRate: 900 }] }), []);
  const merged = mergeDayParts([...parseSleepSummaries(FIXTURES.sleep), ...dailies], '2026-10-11', '2026-10-24');
  assert.equal(merged.find((m) => m.date === '2026-10-24')?.restingHr, 47, 'first source wins per field');
  assert.equal(merged.find((m) => m.date === '2026-10-24')?.steps, 4200);
});

test('activities parse ids, local start, sport and units; skip walks and bad rows', () => {
  const acts = parseActivities(FIXTURES.activities, 'Europe/Madrid');
  assert.deepEqual(acts.map((a) => a.id), ['9001', '9002', '9004']);
  assert.deepEqual(acts[0], { id: '9001', name: 'Rodaje matinal', typeKey: 'running', sport: 'run', date: '2026-10-24', startTime: '08:05', durationMin: 52, distanceM: 9800, avgHr: 149, tss: 55.2 });
  assert.equal(acts[1].sport, 'other');
  assert.equal(acts[2].startTime, '19:00', 'GMT converted to Madrid (CEST)');
});

test('planActivityImport completes matches, inserts the rest and skips known activities', () => {
  const planned = workout({ id: 'w-run', date: '2026-10-24', sport: 'run', durationMin: 50, startTime: '08:00' });
  const known = workout({ id: 'w-known', date: '2026-10-22', status: 'completed', completed: { externalId: '9004', source: 'garmin' } });
  const plan = planActivityImport(parseActivities(FIXTURES.activities, 'Europe/Madrid'), [planned, known], '2026-10-24T10:00:00.000Z');
  assert.deepEqual(plan.completions.map((c) => c.workoutId), ['w-run']);
  assert.equal(plan.completions[0].completed.source, 'garmin');
  assert.equal(plan.completions[0].completed.externalId, '9001');
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].externalId, 'garmin:9002');
  assert.equal(plan.inserts[0].sport, 'other');
  assert.equal(plan.inserts[0].source, 'garmin');
  assert.equal(plan.skipped, 1);
});

test('planActivityImport skips activities already imported from Apple Health (no duplicate completed workouts)', () => {
  const HK_UUID = '6F1C2B9E-3A4D-4E5F-8A9B-0C1D2E3F4A5B';
  // Planned 50' run completed by the HealthKit sync (Garmin Connect → Health → app).
  const healthPlanned = workout({
    id: 'w-hk',
    date: '2026-10-24',
    sport: 'run',
    durationMin: 50,
    startTime: '08:00',
    status: 'completed',
    completed: { source: 'healthkit', externalId: HK_UUID, durationMin: 52 },
  });
  // Unplanned pádel imported from Health (external_id 'healthkit:<uuid>').
  const healthPadel = workout({ id: 'w-padel', date: '2026-10-23', sport: 'other', durationMin: 90, startTime: '19:05', status: 'completed', externalId: `healthkit:${HK_UUID}x`, completed: { source: 'healthkit', durationMin: 88 } });
  const plan = planActivityImport(parseActivities(FIXTURES.activities, 'Europe/Madrid'), [healthPlanned, healthPadel], '2026-10-24T10:00:00.000Z');
  assert.deepEqual(plan.completions, []);
  assert.deepEqual(plan.inserts.map((i) => i.externalId), ['garmin:9004'], 'only the swim is new');
  assert.equal(plan.skipped, 2);
});

test('planActivityImport keeps two real Garmin sessions with the same shape', () => {
  const otherGarmin = workout({ id: 'w-g', date: '2026-10-24', sport: 'run', durationMin: 52, startTime: '08:05', status: 'completed', externalId: 'garmin:8888', completed: { source: 'garmin', externalId: '8888', durationMin: 52 } });
  const plan = planActivityImport(parseActivities(FIXTURES.activities, 'Europe/Madrid'), [otherGarmin], '2026-10-24T10:00:00.000Z');
  assert.ok(plan.inserts.some((i) => i.externalId === 'garmin:9001'), 'a different Garmin activity id is not a duplicate');
});

type Handler = (url: string, init: RequestInit) => Response;

function fakeFetch(handler: Handler, seen: { url: string; init: RequestInit }[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, init });
    return handler(url, init);
  };
}

const okGarmin: Handler = (url, init) => {
  if (url.endsWith(GARMIN_TOKEN_PATH)) {
    return (init.headers as Record<string, string>).Authorization === `ApiKey ${KEY}` ? new Response(JWT) : new Response('nope', { status: 401 });
  }
  if (url.includes('/usersummary-service/v2/dailysummaries')) return Response.json(FIXTURES.dailies);
  if (url.includes('/sleep-service/')) return Response.json(FIXTURES.sleep);
  if (url.includes('/hrv-service/')) return Response.json(FIXTURES.hrv);
  if (url.includes('/bodyBattery/')) return Response.json(FIXTURES.bodyBattery);
  if (url.includes('/activitylist-service/')) return Response.json(FIXTURES.activities);
  return new Response('', { status: 404 });
};

test('Garmin API client: token exchange headers and bearer calls', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const api = createGarminApi(fakeFetch(okGarmin, seen), 'https://garmin.test');
  const token = await api.exchangeKey(KEY);
  assert.equal(token.expiresAt, 1893456000);
  assert.equal(seen[0].init.method, 'POST');
  await api.get('/hrv-service/hrv/daily/2026-10-11/2026-10-24', token);
  assert.equal((seen[1].init.headers as Record<string, string>).Authorization, `Bearer ${JWT}`);
  await assert.rejects(api.exchangeKey('WRONG-KEY-0000000000'), (e: unknown) => e instanceof GarminApiError && e.status === 401 && !e.message.includes('WRONG'));
  const notJwt = createGarminApi(fakeFetch(() => new Response('plain')), 'https://garmin.test');
  await assert.rejects(notJwt.exchangeKey(KEY), (e: unknown) => e instanceof GarminApiError && e.status === 502);
});

test('syncGarminUser upserts metrics with attribution and imports activities', async () => {
  const state = emptyState();
  state.workouts.push(workout({ id: 'w-run', date: '2026-10-24', sport: 'run', durationMin: 50, startTime: '08:00' }));
  const result = await syncGarminUser(
    { api: createGarminApi(fakeFetch(okGarmin), 'https://garmin.test'), store: fakeStore(state), now: fixedNow, logger: silentLogger },
    { userId: USER, apiKey: KEY, timezone: 'Europe/Madrid' },
  );
  assert.equal(result.workoutsCompleted, 1);
  assert.equal(result.activitiesImported, 2);
  assert.equal(result.metricsDays, 2);
  const rows = state.metricUpserts[0].rows;
  assert.ok(rows.every((r) => r.raw.source === 'Garmin'));
  assert.equal(rows.find((r) => r.date === '2026-10-24')?.hrvMs, 63);
  assert.equal(state.workouts.find((w) => w.id === 'w-run')?.status, 'completed');
  const again = await syncGarminUser(
    { api: createGarminApi(fakeFetch(okGarmin), 'https://garmin.test'), store: fakeStore(state), now: fixedNow, logger: silentLogger },
    { userId: USER, apiKey: KEY, timezone: 'Europe/Madrid' },
  );
  assert.equal(again.activitiesImported, 0, 'idempotent');
  assert.equal(again.workoutsCompleted, 0);
});

function credentialStore(initial: GarminCredential | null = null) {
  const rec = { current: initial, deleted: false };
  const store: CredentialStore = {
    getCredential: async () => rec.current,
    saveCredential: async (userId, v) => {
      rec.current = { userId, ciphertext: v.ciphertext, keyExpiresAt: v.keyExpiresAt, state: 'connected', lastSyncAt: null, lastError: null };
    },
    updateCredentialState: async (_u, v) => {
      if (rec.current) rec.current = { ...rec.current, state: v.state, lastError: v.lastError, lastSyncAt: v.lastSyncAt ?? rec.current.lastSyncAt };
    },
    deleteCredential: async () => {
      rec.current = null;
      rec.deleted = true;
    },
    listSyncable: async () => (rec.current ? [rec.current] : []),
    getTimezone: async () => 'Europe/Madrid',
  };
  return { rec, store };
}

function garminDeps(state: FakeState, credentials: CredentialStore, api: GarminApi, overrides: Partial<GarminHttpDeps> = {}): GarminHttpDeps {
  return {
    api,
    store: fakeStore(state),
    credentials,
    keySecret: SECRET,
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer user-jwt' ? USER : null),
    secretKeys: ['sb_secret_x'],
    now: fixedNow,
    logger: silentLogger,
    ...overrides,
  };
}

const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer user-jwt' }): Request =>
  new Request('https://x/functions/v1/garmin', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('connect validates the key with Garmin, stores it encrypted and runs a first sync', async () => {
  const { rec, store } = credentialStore();
  const api = createGarminApi(fakeFetch(okGarmin), 'https://garmin.test');
  const bad = await handleGarminHttp(post({ action: 'connect', apiKey: 'WRONG-KEY-0000000000' }), garminDeps(emptyState(), store, api));
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, 'invalid_key');
  assert.equal(rec.current, null);
  const res = await handleGarminHttp(post({ action: 'connect', apiKey: KEY, expiresAt: '2027-10-24' }), garminDeps(emptyState(), store, api));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { provider: string; state: string; expiresAt: string; sync: { metricsDays: number } | null };
  assert.equal(body.provider, 'garmin_personal');
  assert.equal(body.state, 'connected');
  assert.equal(body.expiresAt, '2027-10-24');
  assert.ok(body.sync && body.sync.metricsDays > 0);
  const saved = (): GarminCredential | null => rec.current; // read after the null assertion above
  const ciphertext = saved()?.ciphertext ?? '';
  assert.ok(ciphertext.length > 0 && !ciphertext.includes(KEY));
  assert.equal(await decryptSecret(ciphertext, SECRET, cipherContext(USER)), KEY);
});

test('sync marks the credential expired on 401 and by date; disconnect deletes it', async () => {
  const { rec, store } = credentialStore();
  const api = createGarminApi(fakeFetch(okGarmin), 'https://garmin.test');
  await handleGarminHttp(post({ action: 'connect', apiKey: KEY }), garminDeps(emptyState(), store, api));
  const revokedApi = createGarminApi(fakeFetch(() => new Response('revoked', { status: 401 })), 'https://garmin.test');
  const expired = await handleGarminHttp(post({ action: 'sync' }), garminDeps(emptyState(), store, revokedApi));
  assert.equal(expired.status, 409);
  assert.equal(rec.current?.state, 'expired');
  assert.equal(rec.current?.lastError, EXPIRED_MESSAGE);
  if (rec.current) rec.current = { ...rec.current, state: 'connected', keyExpiresAt: '2026-10-01' };
  const byDate = await handleGarminHttp(post({ action: 'sync' }), garminDeps(emptyState(), store, api));
  assert.equal(byDate.status, 409);
  const off = await handleGarminHttp(post({ action: 'disconnect' }), garminDeps(emptyState(), store, api));
  assert.equal(off.status, 200);
  assert.equal(rec.deleted, true);
  const notConnected = await handleGarminHttp(post({ action: 'sync' }), garminDeps(emptyState(), store, api));
  assert.equal(notConnected.status, 404);
});

test('auth: user actions need the JWT, sync_all needs the server key, missing secret is 503', async () => {
  const { store } = credentialStore();
  const api = createGarminApi(fakeFetch(okGarmin), 'https://garmin.test');
  assert.equal((await handleGarminHttp(post({ action: 'sync' }, {}), garminDeps(emptyState(), store, api))).status, 401);
  assert.equal((await handleGarminHttp(post({ action: 'sync_all' }), garminDeps(emptyState(), store, api))).status, 401);
  const all = await handleGarminHttp(post({ action: 'sync_all' }, { apikey: 'sb_secret_x' }), garminDeps(emptyState(), store, api));
  assert.equal(all.status, 200);
  assert.deepEqual(await all.json(), { users: 0, ok: 0, expired: 0, failed: 0, skipped: 0 });
  assert.equal((await handleGarminHttp(post({ action: 'sync' }), garminDeps(emptyState(), store, api, { keySecret: undefined }))).status, 503);
  assert.equal((await handleGarminHttp(post({ action: 'explode' }), garminDeps(emptyState(), store, api))).status, 400);
});

test('sleep summaries carry stages (minutes) and start/end instants of the night', () => {
  const payload = [
    {
      dailySleepDTO: {
        calendarDate: '2026-10-24',
        sleepTimeSeconds: 26400,
        deepSleepSeconds: 4860,
        lightSleepSeconds: 15000,
        remSleepSeconds: 5400,
        awakeSleepSeconds: 780,
        sleepStartTimestampGMT: Date.UTC(2026, 9, 23, 21, 10),
        sleepEndTimestampGMT: Date.UTC(2026, 9, 24, 4, 50),
        sleepStartTimestampLocal: Date.UTC(2026, 9, 23, 23, 10),
      },
    },
  ];
  assert.deepEqual(parseSleepSummaries(payload), [
    {
      date: '2026-10-24',
      sleepHours: 7.3,
      sleepDeepMin: 81,
      sleepLightMin: 250,
      sleepRemMin: 90,
      sleepAwakeMin: 13,
      sleepStart: '2026-10-23T21:10:00.000Z',
      sleepEnd: '2026-10-24T04:50:00.000Z',
    },
  ]);
  const rows = toMetricRows(parseSleepSummaries(payload), '2026-10-24T10:00:00.000Z');
  assert.equal(rows[0].sleepDeepMin, 81, 'stages reach the metrics upsert');
  assert.equal(rows[0].sleepEnd, '2026-10-24T04:50:00.000Z');
});

test('sleep start/end fall back to local timestamps (user zone) and drop inconsistent windows', () => {
  const local = parseSleepSummaries(
    { dailySleepDTO: { calendarDate: '2026-10-24', sleepStartTimestampLocal: '2026-10-23T23:10:00.0', sleepEndTimestampLocal: Date.UTC(2026, 9, 24, 6, 50) } },
    'Europe/Madrid',
  );
  assert.equal(local[0].sleepStart, '2026-10-23T21:10:00.000Z', 'CEST wall clock → UTC');
  assert.equal(local[0].sleepEnd, '2026-10-24T04:50:00.000Z');
  const backwards = parseSleepSummaries({
    dailySleepDTO: { calendarDate: '2026-10-24', sleepTimeSeconds: 25200, sleepStartTimestampGMT: Date.UTC(2026, 9, 24, 5), sleepEndTimestampGMT: Date.UTC(2026, 9, 23, 22) },
  });
  assert.deepEqual(backwards, [{ date: '2026-10-24', sleepHours: 7 }]);
  const absurd = parseSleepSummaries({ dailySleepDTO: { calendarDate: '2026-10-24', deepSleepSeconds: 999999, remSleepSeconds: -60, awakeSleepSeconds: '600' } });
  assert.deepEqual(absurd, [{ date: '2026-10-24', sleepAwakeMin: 10 }]);
});

test('the first sync after connecting covers 28 days; later syncs 14', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const api = createGarminApi(fakeFetch(okGarmin, seen), 'https://garmin.test');
  const sleepRange = (): string | null => {
    const url = seen.filter((s) => s.url.includes('/sleep-service/')).pop()?.url ?? '';
    return new URL(url).searchParams.get('startDate');
  };
  const { rec, store } = credentialStore();
  await handleGarminHttp(post({ action: 'connect', apiKey: KEY }), garminDeps(emptyState(), store, api));
  assert.equal(sleepRange(), '2026-09-27', `${FIRST_SYNC_DAYS} days back from 2026-10-24`);
  assert.ok(seen.some((s) => s.url.includes('/activitylist-service/') && s.url.includes('limit=100')));
  await handleGarminHttp(post({ action: 'sync' }), garminDeps(emptyState(), store, api));
  assert.equal(sleepRange(), '2026-10-11', `${SYNC_DAYS} days back`);
  const never = rec.current ? { ...rec.current, lastSyncAt: null } : null;
  assert.ok(never);
  await syncWithCredential({ api, store: fakeStore(emptyState()), credentials: store, keySecret: SECRET, now: fixedNow, logger: silentLogger }, never);
  assert.equal(sleepRange(), '2026-09-27', 'a credential that never synced also gets 28 days');
});
