import assert from 'node:assert/strict';
import test from 'node:test';
import type { CredentialStore, GarminCredential } from '../garmin/credentials.ts';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, fixedNow, NOW, USER, workout } from '../testing/fakes.ts';
import type { UUID } from '../types.ts';
import { EXPIRED_MESSAGE, syncWithCredential } from './credentials.ts';
import { APP_RETURN_URL, handleCorosHttp } from './http.ts';
import type { CorosHttpDeps } from './http.ts';
import { CorosApiError, createCorosMcp, toolText, unwrapText } from './mcp.ts';
import type { CorosMcp, FetchLike } from './mcp.ts';
import {
  authorizeUrl,
  decodeState,
  decryptBundle,
  discoverEndpoints,
  encodeState,
  encryptBundle,
  exchangeCode,
  freshBundle,
  pkceChallenge,
  registerClient,
} from './oauth.ts';
import type { CorosEndpoints, CorosOAuthState, CorosTokenBundle } from './oauth.ts';
import {
  corosSport,
  durationToMin,
  mergeDays,
  parseActivityDetail,
  parseDailyHealth,
  parseRecovery,
  parseRestingHr,
  parseSleepHrv,
  parseSleepOverview,
  parseSportRecords,
  parseTrainingLoad,
  parseVo2max,
} from './parse.ts';
import { externalIdOf, healthTwin, intensityFromFocus, planActivityImport, syncCorosUser } from './sync.ts';

const TZ = 'Europe/Madrid';
const SECRET = 'coros-token-secret-for-tests-0123456789';
/** Unix seconds of a Madrid wall-clock time in late October 2026 (CEST, UTC+2). */
const madrid = (day: number, hh: number, mm: number): number => Date.UTC(2026, 9, day, hh - 2, mm) / 1000;

// Layout copied from real COROS MCP answers (Nov 2026); every number and place is made up.
const SPORT_RECORDS = `Sport Records — 2026-10-18 to 2026-10-24 (4 records)
========================

1. Outdoor Run — 2026-10-24
   Location: Parque Fluvial
   Start Coordinates: 39.400000, -0.300000
   Time Window: startTimestamp=${madrid(24, 8, 5)} | endTimestamp=${madrid(24, 9, 0)}
   Duration: 52:30 | Distance: 10.20 km
   Average Pace: 5:09 /km | Avg HR: 148 bpm | Calories: 700 kcal
   LabelId: 7000000000000000001 | SportType: 100

2. Pool Swim — 2026-10-23
   Location: Piscina Municipal
   Time Window: startTimestamp=${madrid(23, 19, 0)} | endTimestamp=${madrid(23, 20, 15)}
   Duration: 44:10 | Distance: 2.40 km
   Average Pace: 1:50 /km | Avg HR: 130 bpm | Calories: 380 kcal
   LabelId: 7000000000000000002 | SportType: 300

3. Walk — 2026-10-23
   Time Window: startTimestamp=${madrid(23, 12, 0)} | endTimestamp=${madrid(23, 12, 40)}
   Duration: 40:00 | Distance: 3.10 km
   LabelId: 7000000000000000003 | SportType: 900

4. Road Bike — 2026-10-22
   Location: Puerto de prueba
   Time Window: startTimestamp=${madrid(22, 9, 30)} | endTimestamp=${madrid(22, 12, 30)}
   Duration: 2:35:00 | Distance: 75.50 km
   Avg HR: 139 bpm | Calories: 1500 kcal
   LabelId: 7000000000000000004 | SportType: 200
`;

const DETAIL = `🏃 Outdoor Run Activity Details
========================================

Workout Time: 52:30
Distance: 10.20 km
Total Time: 55:02
Average Heart Rate: 148 bpm
Training Load: 92
Aerobic TE: 3.1
Anaerobic TE: 0.4
Training Focus: Base
Performance: Normal`;

const DAILY_HEALTH = `Daily Health Data — Last 3 days | Resting HR: 48 bpm | HRV Baseline: 55 ms
Note: sleep entries are dated by their wake-up day.

--- 20261022 ---
Steps: 1,204 | Calories: 300 kcal | Exercise: 0 min
Stress: Avg 41
Sleep Summary:
  Total: 1h 40min | Deep: 10 min | Light: 1h 10min | REM: 12 min | Awake: 8 min
  Sleep HR: Avg 55 bpm | Min 50 bpm | Max 60 bpm

--- 20261023 ---
Steps: 12,345 | Calories: 1,100 kcal | Exercise: 1h 5min
Stress: Avg 28
Sleep Summary:
  Total: 8h 20min | Deep: 1h 10min | Light: 4h 50min | REM: 1h 50min | Awake: 30 min
  Sleep HR: Avg 49 bpm | Min 44 bpm | Max 58 bpm

--- 20261024 ---
Steps: 3,456 | Calories: 600 kcal | Exercise: 52 min
Stress: Avg 25
Sleep Summary:
  Total: 7h 40min | Deep: 58 min | Light: 4h 32min | REM: 1h 40min | Awake: 30 min
  Sleep HR: Avg 48 bpm | Min 43 bpm | Max 57 bpm`;

const SLEEP_OVERVIEW = `Sleep Overview
========================
Note: each record below is dated by its wake-up day.

2026-10-22
Sleep data not available for this day.

2026-10-23
Sleep Score: 81
Daily Sleep: 7h 50min (incl. naps)
Main Sleep (asleep): 7h 50min
Main Sleep Period (incl. awake): 8h 20min
Awake Time: 30 min
Main Sleep Window: 2026-10-22 23:30 - 2026-10-23 07:50
Naps Total: 0 min

2026-10-24
Sleep Score: 77
Daily Sleep: 7h 10min (incl. naps)
Main Sleep (asleep): 7h 10min
Awake Time: 30 min
Main Sleep Window: 2026-10-24 00:05 - 2026-10-24 07:45
Naps Total: 0 min`;

const SLEEP_HRV = `Sleep HRV — 2026-10-22 to 2026-10-24
========================

HRV Assessment — Last 3 days
========================

2026-10-24:
  HRV Avg: 61 ms — Normal
  Normal Range: 48 - 66 ms
  Baseline: 57 ms
2026-10-23:
  HRV Avg: 64 ms — Above normal
  Normal Range: 48 - 66 ms
  Baseline: 57 ms

Sleep HRV Time Series — Last 3 days
========================

2026-10-24:
  timestamp=1792800000, timezone=4, hrv=99 ms, status=4, confidence=100000`;

const RESTING = `Resting Heart Rate — Last 3 days
========================

2026-10-24: 47 bpm
2026-10-23: 49 bpm
2026-10-22: 0 bpm`;

const LOAD = `Training Load Assessment
========================

2026-10-24
Comment: Optimized
Short-Term Load: 100
Long-Term Load: 80
Load Ratio: 1.25

2026-10-23
Comment: Excessive
Short-Term Load: 120
Long-Term Load: 80
Load Ratio: 1.50`;

const RECOVERY = `Recovery Status
========================

Recovery: 82%
Level: Normal
Estimated Full Recovery: 12h`;

const FITNESS = `Fitness Assessment Overview
========================

VO2max: 58
Running Level: 80
Threshold Pace: 4:20 /km`;

const TOOL_TEXT: Record<string, string> = {
  querySportRecords: SPORT_RECORDS,
  getActivityDetail: DETAIL,
  queryDailyHealthData: DAILY_HEALTH,
  querySleepOverview: SLEEP_OVERVIEW,
  querySleepHrv: SLEEP_HRV,
  queryRestingHeartRate: RESTING,
  queryTrainingLoadAssessment: LOAD,
  queryRecoveryStatus: RECOVERY,
  queryFitnessAssessmentOverview: FITNESS,
};

function fakeMcp(overrides: Partial<Record<string, string | Error>> = {}): CorosMcp & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      const value = name in overrides ? overrides[name] : TOOL_TEXT[name];
      if (value instanceof Error) throw value;
      if (value === undefined) throw new CorosApiError(502, `unknown tool ${name}`);
      return value;
    },
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

test('sport records: local date and time, moving duration, distance and HR; walks skipped', () => {
  const acts = parseSportRecords(SPORT_RECORDS, TZ);
  assert.deepEqual(
    acts.map((a) => [a.id, a.sport, a.date, a.startTime, a.durationMin, a.distanceM, a.avgHr]),
    [
      ['7000000000000000001', 'run', '2026-10-24', '08:05', 53, 10200, 148],
      ['7000000000000000002', 'swim', '2026-10-23', '19:00', 44, 2400, 130],
      ['7000000000000000004', 'bike', '2026-10-22', '09:30', 155, 75500, 139],
    ],
  );
  assert.equal(acts[0].name, 'Parque Fluvial');
});

test('sport mapping by name, with the SportType family as fallback', () => {
  assert.equal(corosSport('Track Run', '103'), 'run');
  assert.equal(corosSport('Open Water', '301'), 'swim');
  assert.equal(corosSport('Indoor Bike', '201'), 'bike');
  assert.equal(corosSport('Triathlon', '500'), 'brick');
  assert.equal(corosSport('Strength', '402'), 'strength');
  assert.equal(corosSport('Hike', '104'), null);
  assert.equal(corosSport('Mystery', '205'), 'bike');
  assert.equal(corosSport('Mystery', '999'), 'other');
  assert.equal(durationToMin('1h 5min'), 65);
  assert.equal(durationToMin('57 min'), 57);
  assert.equal(durationToMin('nada'), null);
});

test('activity detail: training load, total time and focus', () => {
  assert.deepEqual(parseActivityDetail(DETAIL), { trainingLoad: 92, totalTimeSec: 3302, trainingFocus: 'Base' });
  assert.equal(intensityFromFocus('VO2 Max'), 'vo2');
  assert.equal(intensityFromFocus('Anaerobic'), 'vo2');
  assert.equal(intensityFromFocus('Threshold'), 'threshold');
  assert.equal(intensityFromFocus('Recovery'), 'recovery');
  assert.equal(intensityFromFocus(null), 'endurance');
});

test('wellness reports merge into one row per wake-up day', () => {
  const daily = parseDailyHealth(DAILY_HEALTH);
  // A 1h40 "night" is a watch taken off: steps and stress stay, the stages do not.
  assert.deepEqual(daily[0], { date: '2026-10-22', steps: 1204, stressAvg: 41 });
  assert.deepEqual(daily[1], { date: '2026-10-23', steps: 12345, stressAvg: 28, sleepDeepMin: 70, sleepLightMin: 290, sleepRemMin: 110, sleepAwakeMin: 30 });

  const sleep = parseSleepOverview(SLEEP_OVERVIEW, TZ);
  assert.deepEqual(sleep[0], {
    date: '2026-10-23',
    sleepHours: 7.83,
    sleepScore: 81,
    sleepStart: '2026-10-22T21:30:00.000Z',
    sleepEnd: '2026-10-23T05:50:00.000Z',
  });
  assert.equal(sleep.length, 2);

  assert.deepEqual(parseSleepHrv(SLEEP_HRV), [
    { date: '2026-10-24', hrvMs: 61 },
    { date: '2026-10-23', hrvMs: 64 },
  ]);
  assert.deepEqual(parseRestingHr(RESTING), [
    { date: '2026-10-24', restingHr: 47 },
    { date: '2026-10-23', restingHr: 49 },
  ]);
  assert.deepEqual(parseTrainingLoad(LOAD), [
    { date: '2026-10-24', trainingStatus: 'Optimized' },
    { date: '2026-10-23', trainingStatus: 'Excessive' },
  ]);
  assert.equal(parseRecovery(RECOVERY), 82);
  assert.equal(parseVo2max(FITNESS), 58);

  const merged = mergeDays([...daily, ...sleep, ...parseSleepHrv(SLEEP_HRV), { date: '2026-09-01', steps: 1 }], '2026-10-22', '2026-10-24');
  assert.deepEqual(merged.map((d) => d.date), ['2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(merged[1].hrvMs, 64);
  assert.equal(merged[1].sleepScore, 81);
});

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

test('tool text: JSON string literals are unwrapped; tool errors throw', () => {
  assert.equal(unwrapText('"Sport Records\\nline"'), 'Sport Records\nline');
  assert.equal(unwrapText('plain'), 'plain');
  assert.equal(toolText({ result: { content: [{ type: 'text', text: '"hola"' }] } }, 't'), 'hola');
  assert.throws(() => toolText({ result: { content: [{ type: 'text', text: 'boom' }], isError: true } }, 't'), CorosApiError);
  assert.throws(() => toolText({ error: { code: -32602, message: 'bad' } }, 't'), /bad/);
});

test('MCP client posts tools/call with the bearer token; JSON and SSE answers; 401 is an auth error', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const answers = [
    new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'uno' }] } }), { headers: { 'content-type': 'application/json' } }),
    new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'dos' }] } })}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    }),
    new Response('nope', { status: 401 }),
  ];
  const fetchFn: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return answers.shift() as Response;
  };
  const mcp = createCorosMcp({ resource: 'https://mcpeu.example/mcp', accessToken: 'AT', fetch: fetchFn });
  assert.equal(await mcp.callTool('a', { days: 3 }), 'uno');
  assert.equal(await mcp.callTool('b', {}), 'dos');
  await assert.rejects(mcp.callTool('c', {}), (e: unknown) => e instanceof CorosApiError && e.status === 401);
  const body = JSON.parse(String(seen[0].init?.body));
  assert.equal(body.method, 'tools/call');
  assert.deepEqual(body.params, { name: 'a', arguments: { days: 3 } });
  assert.equal((seen[0].init?.headers as Record<string, string>).authorization, 'Bearer AT');
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

const ENDPOINTS: CorosEndpoints = {
  resource: 'https://mcpeu.example/mcp',
  issuer: 'https://mcpeu.example',
  authorizationEndpoint: 'https://mcpeu.example/oauth2/authorize',
  tokenEndpoint: 'https://mcpeu.example/oauth2/token',
  registrationEndpoint: 'https://mcpeu.example/connect/register',
};
const CLIENT = { clientId: 'client-1', clientSecret: 'client-secret', redirectUri: 'https://proj.supabase.co/functions/v1/coros/callback' };

function oauthFetch(log: { url: string; body: string }[] = [], token: Record<string, unknown> = { access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600 }): FetchLike {
  return async (url, init) => {
    log.push({ url, body: String(init?.body ?? '') });
    if (url === 'https://mcp.example/.well-known/oauth-protected-resource/mcp') {
      return Response.json({ resource: ENDPOINTS.resource, authorization_servers: [ENDPOINTS.issuer] });
    }
    if (url === 'https://mcpeu.example/.well-known/oauth-authorization-server') {
      return Response.json({
        issuer: ENDPOINTS.issuer,
        authorization_endpoint: ENDPOINTS.authorizationEndpoint,
        token_endpoint: ENDPOINTS.tokenEndpoint,
        registration_endpoint: ENDPOINTS.registrationEndpoint,
      });
    }
    if (url === ENDPOINTS.registrationEndpoint) return Response.json({ client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret });
    if (url === ENDPOINTS.tokenEndpoint) return Response.json(token);
    return new Response('not found', { status: 404 });
  };
}

test('discovery follows the protected-resource metadata to the regional server; registration returns the client', async () => {
  const log: { url: string; body: string }[] = [];
  const endpoints = await discoverEndpoints(oauthFetch(log), 'https://mcp.example/mcp');
  assert.deepEqual(endpoints, ENDPOINTS);
  const client = await registerClient(oauthFetch(log), endpoints, CLIENT.redirectUri);
  assert.deepEqual(client, CLIENT);
  const reg = JSON.parse(log.at(-1)?.body ?? '{}');
  assert.deepEqual(reg.redirect_uris, [CLIENT.redirectUri]);
  assert.match(reg.scope, /offline_access/);
});

test('state is encrypted, tamper-proof and expires; the authorize URL carries PKCE and the resource', async () => {
  const state: CorosOAuthState = { userId: USER, verifier: 'verifier-123', endpoints: ENDPOINTS, client: CLIENT, expiresAt: NOW.getTime() + 60_000 };
  const encoded = await encodeState(state, SECRET);
  assert.ok(!encoded.includes(USER));
  assert.deepEqual(await decodeState(encoded, SECRET, NOW.getTime()), state);
  assert.equal(await decodeState(encoded, SECRET, NOW.getTime() + 120_000), null);
  assert.equal(await decodeState(`${encoded}x`, SECRET, NOW.getTime()), null);
  assert.equal(await decodeState(encoded, 'another-secret-of-enough-length', NOW.getTime()), null);

  const url = new URL(await authorizeUrl(state, encoded));
  assert.equal(url.origin + url.pathname, ENDPOINTS.authorizationEndpoint);
  assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge('verifier-123'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('resource'), ENDPOINTS.resource);
  assert.equal(url.searchParams.get('redirect_uri'), CLIENT.redirectUri);
  assert.equal(url.searchParams.get('state'), encoded);
});

test('code exchange and refresh: rotating refresh tokens, previous one kept when none comes back', async () => {
  const log: { url: string; body: string }[] = [];
  const state: CorosOAuthState = { userId: USER, verifier: 'v', endpoints: ENDPOINTS, client: CLIENT, expiresAt: 0 };
  const bundle = await exchangeCode(oauthFetch(log), state, 'CODE', NOW.getTime());
  assert.equal(bundle.accessToken, 'AT-1');
  assert.equal(bundle.refreshToken, 'RT-1');
  const form = new URLSearchParams(log.at(-1)?.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code_verifier'), 'v');
  assert.equal(form.get('client_secret'), 'client-secret');

  const fresh = await freshBundle(oauthFetch(), bundle, NOW.getTime());
  assert.equal(fresh.refreshed, false);
  const later = NOW.getTime() + 3600_000;
  const renewed = await freshBundle(oauthFetch(log, { access_token: 'AT-2', expires_in: 600 }), bundle, later);
  assert.equal(renewed.refreshed, true);
  assert.equal(renewed.bundle.accessToken, 'AT-2');
  assert.equal(renewed.bundle.refreshToken, 'RT-1');
  assert.equal(new URLSearchParams(log.at(-1)?.body).get('grant_type'), 'refresh_token');

  const roundTrip = await decryptBundle(await encryptBundle(bundle, SECRET, USER), SECRET, USER);
  assert.deepEqual(roundTrip, bundle);
});

// ---------------------------------------------------------------------------
// Import plan and sync
// ---------------------------------------------------------------------------

test('import plan: Claude-logged and Apple Salud twins are skipped, planned sessions completed, the rest inserted', () => {
  const [run, swim, bike] = parseSportRecords(SPORT_RECORDS, TZ);
  const workouts = [
    // Already logged by the athlete's Claude with the same COROS id.
    workout({ id: 'w-claude', date: '2026-10-22', sport: 'bike', status: 'completed', externalId: externalIdOf(bike.id), completed: { source: 'claude', externalId: externalIdOf(bike.id) } }),
    // COROS → Apple Salud import of the swim: elapsed time (75') instead of moving time (44').
    workout({ id: 'w-health', date: '2026-10-23', sport: 'swim', startTime: '19:00', durationMin: 75, status: 'completed', completed: { source: 'healthkit', durationMin: 75 } }),
    workout({ id: 'w-plan', date: '2026-10-24', sport: 'run', startTime: '08:00', durationMin: 50, status: 'planned' }),
  ];
  assert.equal(healthTwin(swim, workouts)?.id, 'w-health');
  const plan = planActivityImport([run, swim, bike], workouts, NOW.toISOString());
  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.completions.map((c) => c.workoutId), ['w-plan']);
  assert.equal(plan.completions[0].completed.source, 'coros');
  assert.equal(plan.completions[0].completed.externalId, externalIdOf(run.id));
  assert.equal(plan.inserts.length, 0);

  const fresh = planActivityImport([run], [], NOW.toISOString(), new Map([[run.id, 'Threshold']]));
  assert.equal(fresh.inserts[0].source, 'coros');
  assert.equal(fresh.inserts[0].externalId, `coros:${run.id}`);
  assert.equal(fresh.inserts[0].intensity, 'threshold');
  assert.equal(fresh.inserts[0].title, 'Parque Fluvial');
});

test('sync: activities with training load, wellness merged per day (source coros), snapshots on today', async () => {
  const state = emptyState();
  const store = fakeStore(state);
  const mcp = fakeMcp();
  const result = await syncCorosUser({ store, now: fixedNow, logger: silentLogger }, mcp, { userId: USER, timezone: TZ, days: 3 });
  assert.equal(result.activitiesImported, 3);
  assert.equal(result.metricsDays, 3);
  assert.match(result.message, /COROS sincronizado/);

  const records = mcp.calls.find((c) => c.name === 'querySportRecords');
  assert.deepEqual(records?.args, { startDate: '20261022', endDate: '20261024', limit: 100 });
  const run = state.workouts.find((w) => w.sport === 'run');
  assert.equal(run?.completed?.tss, 92);
  assert.equal(run?.intensity, 'endurance');

  const upsert = state.metricUpserts[0];
  assert.equal(upsert.source, 'coros');
  const today = upsert.rows.find((r) => r.date === '2026-10-24');
  assert.equal(today?.hrvMs, 61);
  assert.equal(today?.restingHr, 47);
  assert.equal(today?.trainingReadiness, 82);
  assert.equal(today?.vo2max, 58);
  assert.equal(today?.trainingStatus, 'Optimized');
  assert.equal(today?.raw.via, 'coros_mcp');

  // Second run: nothing new is imported.
  const again = await syncCorosUser({ store, now: fixedNow, logger: silentLogger }, fakeMcp(), { userId: USER, timezone: TZ, days: 3 });
  assert.equal(again.activitiesImported, 0);
});

test('sync: a failing wellness report is skipped; an auth failure aborts', async () => {
  const state = emptyState();
  const ok = await syncCorosUser({ store: fakeStore(state), now: fixedNow, logger: silentLogger }, fakeMcp({ querySleepHrv: new CorosApiError(502, 'down') }), {
    userId: USER,
    timezone: TZ,
    days: 3,
  });
  assert.equal(ok.metricsDays, 3);
  await assert.rejects(
    syncCorosUser({ store: fakeStore(emptyState()), now: fixedNow, logger: silentLogger }, fakeMcp({ querySportRecords: new CorosApiError(401, 'no') }), {
      userId: USER,
      timezone: TZ,
    }),
    (e: unknown) => e instanceof CorosApiError && e.status === 401,
  );
});

// ---------------------------------------------------------------------------
// Credentials and HTTP
// ---------------------------------------------------------------------------

function memoryCredentials(): CredentialStore & { rows: Map<UUID, GarminCredential> } {
  const rows = new Map<UUID, GarminCredential>();
  return {
    rows,
    async getCredential(userId) {
      return rows.get(userId) ?? null;
    },
    async saveCredential(userId, value) {
      const prev = rows.get(userId);
      rows.set(userId, { userId, ciphertext: value.ciphertext, keyExpiresAt: value.keyExpiresAt, state: 'connected', lastSyncAt: prev?.lastSyncAt ?? null, lastError: null });
    },
    async updateCredentialState(userId, value) {
      const prev = rows.get(userId);
      if (prev) rows.set(userId, { ...prev, state: value.state, lastError: value.lastError, lastSyncAt: value.lastSyncAt ?? prev.lastSyncAt });
    },
    async deleteCredential(userId) {
      rows.delete(userId);
    },
    async listSyncable() {
      return [...rows.values()].filter((r) => r.state === 'connected' || r.state === 'error');
    },
    async getTimezone() {
      return TZ;
    },
  };
}

/** COROS OAuth server + MCP resource answering the fixtures. */
function corosServer(opts: { mcpStatus?: number } = {}): FetchLike {
  const oauth = oauthFetch();
  return async (url, init) => {
    if (url === ENDPOINTS.resource) {
      if (opts.mcpStatus) return new Response('', { status: opts.mcpStatus });
      const { params, id } = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(TOOL_TEXT[params.name] ?? '') }] } });
    }
    return oauth(url, init);
  };
}

function httpDeps(overrides: Partial<CorosHttpDeps> = {}): CorosHttpDeps & { credentials: ReturnType<typeof memoryCredentials>; state: ReturnType<typeof emptyState> } {
  const state = emptyState();
  const credentials = memoryCredentials();
  return {
    state,
    store: fakeStore(state),
    credentials,
    fetch: corosServer(),
    tokenSecret: SECRET,
    callbackUrl: CLIENT.redirectUri,
    entryUrl: 'https://mcp.example/mcp',
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer user-jwt' ? USER : null),
    secretKeys: ['sb_secret_test'],
    now: fixedNow,
    logger: silentLogger,
    ...overrides,
  } as CorosHttpDeps & { credentials: ReturnType<typeof memoryCredentials>; state: ReturnType<typeof emptyState> };
}

const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer user-jwt' }): Request =>
  new Request('https://proj.supabase.co/functions/v1/coros', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('http: start needs the user and returns the COROS authorization URL', async () => {
  const deps = httpDeps();
  assert.equal((await handleCorosHttp(post({ action: 'start' }, {}), deps)).status, 401);
  const res = await handleCorosHttp(post({ action: 'start' }), deps);
  assert.equal(res.status, 200);
  const { url } = (await res.json()) as { url: string };
  assert.ok(url.startsWith(ENDPOINTS.authorizationEndpoint));
  const state = await decodeState(new URL(url).searchParams.get('state') ?? '', SECRET, NOW.getTime());
  assert.equal(state?.userId, USER);
});

test('http: the callback stores the encrypted tokens, runs the first sync and returns to the app', async () => {
  const deps = httpDeps();
  const start = (await (await handleCorosHttp(post({ action: 'start' }), deps)).json()) as { url: string };
  const rawState = new URL(start.url).searchParams.get('state') ?? '';
  const res = await handleCorosHttp(new Request(`${CLIENT.redirectUri}?code=CODE&state=${encodeURIComponent(rawState)}`), deps);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `${APP_RETURN_URL}?coros=connected`);
  const saved = deps.credentials.rows.get(USER);
  assert.ok(saved && !saved.ciphertext.includes('AT-1'));
  assert.equal(saved?.state, 'connected');
  assert.ok(saved?.lastSyncAt);
  assert.equal(deps.state.workouts.length, 3);
  const bundle: CorosTokenBundle = await decryptBundle(saved?.ciphertext ?? '', SECRET, USER);
  assert.equal(bundle.refreshToken, 'RT-1');
});

test('http: a forged or missing state never connects anyone', async () => {
  const deps = httpDeps();
  const forged = await handleCorosHttp(new Request(`${CLIENT.redirectUri}?code=CODE&state=v1.forged.state`), deps);
  assert.equal(forged.headers.get('location'), `${APP_RETURN_URL}?coros=error&reason=expired_state`);
  const denied = await handleCorosHttp(new Request(`${CLIENT.redirectUri}?error=access_denied`), deps);
  assert.equal(denied.headers.get('location'), `${APP_RETURN_URL}?coros=error&reason=access_denied`);
  assert.equal(deps.credentials.rows.size, 0);
});

test('http: sync, expired token, disconnect and the scheduled sync_all', async () => {
  const deps = httpDeps();
  assert.equal((await handleCorosHttp(post({ action: 'sync' }), deps)).status, 404);
  const bundle: CorosTokenBundle = { endpoints: ENDPOINTS, client: CLIENT, accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW.getTime() + 3600_000 };
  await deps.credentials.saveCredential(USER, { ciphertext: await encryptBundle(bundle, SECRET, USER), keyExpiresAt: null });

  const synced = await handleCorosHttp(post({ action: 'sync' }), deps);
  assert.equal(synced.status, 200);
  assert.equal(((await synced.json()) as { activitiesImported: number }).activitiesImported, 3);

  assert.equal((await handleCorosHttp(post({ action: 'sync_all' }, {}), deps)).status, 401);
  const all = await handleCorosHttp(post({ action: 'sync_all' }, { apikey: 'sb_secret_test' }), deps);
  assert.deepEqual(await all.json(), { users: 1, ok: 1, expired: 0, failed: 0, skipped: 0 });

  const expiredDeps = { ...deps, fetch: corosServer({ mcpStatus: 401 }) };
  const expired = await handleCorosHttp(post({ action: 'sync' }), expiredDeps);
  assert.equal(expired.status, 409);
  assert.equal(deps.credentials.rows.get(USER)?.state, 'expired');
  assert.equal(deps.credentials.rows.get(USER)?.lastError, EXPIRED_MESSAGE);

  const off = await handleCorosHttp(post({ action: 'disconnect' }), deps);
  assert.equal(((await off.json()) as { state: string }).state, 'disconnected');
  assert.equal(deps.credentials.rows.size, 0);
});

test('http: a refreshed token is stored again; missing secret answers 503 / error redirect', async () => {
  const deps = httpDeps();
  const old: CorosTokenBundle = { endpoints: ENDPOINTS, client: CLIENT, accessToken: 'OLD', refreshToken: 'RT-0', expiresAt: NOW.getTime() - 1 };
  await deps.credentials.saveCredential(USER, { ciphertext: await encryptBundle(old, SECRET, USER), keyExpiresAt: null });
  const saved = deps.credentials.rows.get(USER) as GarminCredential;
  const outcome = await syncWithCredential({ ...deps, tokenSecret: SECRET }, saved);
  assert.equal(outcome.ok, true);
  const stored = await decryptBundle(deps.credentials.rows.get(USER)?.ciphertext ?? '', SECRET, USER);
  assert.equal(stored.accessToken, 'AT-1');
  assert.equal(stored.refreshToken, 'RT-1');

  const broken = httpDeps({ tokenSecret: undefined });
  assert.equal((await handleCorosHttp(post({ action: 'start' }), broken)).status, 503);
  const redirect = await handleCorosHttp(new Request(`${CLIENT.redirectUri}?code=x&state=y`), broken);
  assert.equal(redirect.headers.get('location'), `${APP_RETURN_URL}?coros=error&reason=server_misconfigured`);
});
