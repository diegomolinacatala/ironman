import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, USER, workout } from '../testing/fakes.ts';
import { analysisCandidates, analysisPatch, analyzeGarminActivities } from './analysis.ts';
import { createGarminApi, GARMIN_TOKEN_PATH } from './api.ts';
import type { GarminToken } from './api.ts';
import { decodeFitRecords, FitError, fitFromDownload } from './fit.ts';
import type { ActivitySample } from './fit.ts';
import { computeStreamMetrics, normalizedPower, resample } from './streamMetrics.ts';

// ---------------------------------------------------------------------------
// A tiny FIT encoder for the tests: file_id + record messages (timestamp, HR, power, speed).
// ---------------------------------------------------------------------------

interface EncodeOptions {
  /** Write every other record with a compressed timestamp header. */
  compressed?: boolean;
  bigEndian?: boolean;
  /** Add a developer field (2 bytes) to the record definition. */
  developer?: boolean;
}

function encodeFit(samples: readonly ActivitySample[], opts: EncodeOptions = {}): Uint8Array {
  const body: number[] = [];
  const le = !opts.bigEndian;
  const u16 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) => {
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    return le ? b : b.reverse();
  };
  // file_id (global 0), local 1: field 0 type (enum, 1 byte).
  body.push(0x41, 0, le ? 0 : 1, ...u16(0), 1, 0, 1, 0x00);
  body.push(0x01, 4);
  // record (global 20), local 0: timestamp u32, heart_rate u8, power u16, enhanced_speed u32.
  body.push(opts.developer ? 0x60 : 0x40, 0, le ? 0 : 1, ...u16(20), 4, 253, 4, 0x86, 3, 1, 0x02, 7, 2, 0x84, 73, 4, 0x86);
  if (opts.developer) body.push(1, 0, 2, 0);
  // Compressed records (header 0x80 | local 2 << 5) need a definition without the timestamp.
  if (opts.compressed) body.push(0x42, 0, le ? 0 : 1, ...u16(20), 3, 3, 1, 0x02, 7, 2, 0x84, 73, 4, 0x86);
  samples.forEach((s, i) => {
    const values = [s.hr ?? 0xff, ...u16(s.powerW ?? 0xffff), ...u32(s.speedMps !== undefined ? Math.round(s.speedMps * 1000) : 0xffffffff)];
    if (opts.compressed && i % 2 === 1) {
      body.push(0x80 | (2 << 5) | (s.t & 0x1f), ...values);
    } else {
      body.push(0x00, ...u32(s.t), ...values);
      if (opts.developer) body.push(0xaa, 0xbb);
    }
  });
  const header = [14, 0x20, 0x08, 0x08, ...[body.length & 0xff, (body.length >> 8) & 0xff, (body.length >> 16) & 0xff, 0], 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...header, ...body, 0, 0]);
}

/** A ZIP with one entry (stored, or deflated when `method` is 8), sizes in the central directory only. */
function zipStored(name: string, data: Uint8Array, method = 0): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const local = [0x50, 0x4b, 0x03, 0x04, 20, 0, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, nameBytes.length, 0, 0, 0];
  const size = [data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, 0];
  const central = [0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0x08, 0, method, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...size, ...size, nameBytes.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const cdOffset = local.length + nameBytes.length + data.length;
  const cdSize = central.length + nameBytes.length;
  const eocd = [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0, cdSize, 0, 0, 0, cdOffset & 0xff, (cdOffset >> 8) & 0xff, (cdOffset >> 16) & 0xff, 0, 0, 0];
  return new Uint8Array([...local, ...nameBytes, ...data, ...central, ...nameBytes, ...eocd]);
}

const T0 = 1_100_000_000;

/** `minutes` of 1 Hz samples; `at(s)` gives hr/power/speed at second s. */
function session(minutes: number, at: (s: number) => Omit<ActivitySample, 't'>): ActivitySample[] {
  return Array.from({ length: minutes * 60 }, (_, s) => ({ t: T0 + s, ...at(s) }));
}

// ---------------------------------------------------------------------------
// FIT reader
// ---------------------------------------------------------------------------

test('decodeFitRecords reads timestamp, HR, power and speed and drops invalid values', () => {
  const samples: ActivitySample[] = [
    { t: T0, hr: 120, powerW: 200, speedMps: 8.5 },
    { t: T0 + 1, hr: 121 },
    { t: T0 + 2, powerW: 0, speedMps: 0 },
  ];
  assert.deepEqual(decodeFitRecords(encodeFit(samples)), samples);
  assert.deepEqual(decodeFitRecords(encodeFit(samples, { bigEndian: true })), samples, 'big-endian definitions');
  assert.deepEqual(decodeFitRecords(encodeFit(samples, { developer: true })), samples, 'developer fields are skipped');
});

test('decodeFitRecords resolves compressed timestamp headers, also across the 32 s rollover', () => {
  const samples = [30, 31, 33, 40, 62, 64].map((d, i) => ({ t: T0 + d, hr: 100 + i }));
  assert.deepEqual(decodeFitRecords(encodeFit(samples, { compressed: true })), samples);
});

test('fitFromDownload accepts the ZIP Garmin serves or a bare .fit, and refuses anything else', async () => {
  const fit = encodeFit([{ t: T0, hr: 130 }]);
  assert.deepEqual(await fitFromDownload(zipStored('12345_ACTIVITY.fit', fit)), [{ t: T0, hr: 130 }]);
  assert.deepEqual(await fitFromDownload(fit), [{ t: T0, hr: 130 }]);
  const deflated = new Uint8Array(await new Response(new Blob([fit as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  assert.deepEqual(await fitFromDownload(zipStored('12345_ACTIVITY.fit', deflated, 8)), [{ t: T0, hr: 130 }], 'deflated entry');
  await assert.rejects(fitFromDownload(zipStored('notes.txt', fit)), FitError);
  await assert.rejects(fitFromDownload(new TextEncoder().encode('<html>')), FitError);
});

// ---------------------------------------------------------------------------
// Metrics (camino-703 formulas)
// ---------------------------------------------------------------------------

test('resample holds a sample up to 5 s and counts a longer pause once', () => {
  const secs = resample([
    { t: 0, hr: 100 },
    { t: 3, hr: 110 },
    { t: 100, hr: 120 },
  ]);
  assert.deepEqual(
    secs.map((s) => s.hr),
    [100, 100, 100, 110, 120],
  );
});

test('normalized power: steady power is its own NP, surges raise it', () => {
  assert.equal(normalizedPower(Array(600).fill(200)), 200);
  const surges = Array.from({ length: 1200 }, (_, i) => (Math.floor(i / 60) % 2 === 0 ? 300 : 100));
  const np = normalizedPower(surges) ?? 0;
  assert.ok(np > 200 && np < 300, `NP ${np} between the mean and the peak`);
  assert.equal(normalizedPower(Array(20).fill(200)), undefined, 'under 30 s');
});

test('bike: NP, IF against the FTP and the power curve', () => {
  const ride = session(70, (s) => ({ hr: 140, powerW: s < 300 ? 300 : 200 }));
  const m = computeStreamMetrics({ sport: 'bike', samples: ride, ftpW: 250 });
  assert.equal(m.bestPower1MinW, 300);
  assert.equal(m.bestPower5MinW, 300);
  assert.equal(m.bestPower20MinW, 225);
  assert.equal(m.bestPower60MinW, 208);
  assert.ok(m.normalizedPowerW && m.normalizedPowerW >= 208);
  assert.equal(m.intensityFactor, Math.round(((m.normalizedPowerW ?? 0) / 250) * 100) / 100);
  assert.equal(computeStreamMetrics({ sport: 'bike', samples: ride }).intensityFactor, undefined, 'no FTP, no IF');
});

test('run: heart rate rising at the same pace is decoupling and drift', () => {
  // 60 min at 3.0 m/s; HR 140 → 152 linearly after the warm-up.
  const run = session(60, (s) => ({ speedMps: 3, hr: s < 600 ? 130 : 140 + (12 * (s - 600)) / 3000 }));
  const m = computeStreamMetrics({ sport: 'run', samples: run });
  assert.ok(m.hrDriftBpm !== undefined && m.hrDriftBpm > 5.5 && m.hrDriftBpm < 6.5, `drift ${m.hrDriftBpm}`);
  assert.ok(m.decouplingPct !== undefined && m.decouplingPct > 3 && m.decouplingPct < 5, `decoupling ${m.decouplingPct}`);
  assert.equal(m.normalizedPowerW, undefined, 'no power on a run without a power meter');
});

test('steady heart rate is ~0 % decoupling; short or walking sessions get none', () => {
  const steady = computeStreamMetrics({ sport: 'run', samples: session(50, () => ({ speedMps: 3.2, hr: 145 })) });
  assert.deepEqual({ d: steady.decouplingPct, h: steady.hrDriftBpm }, { d: 0, h: 0 });
  assert.deepEqual(computeStreamMetrics({ sport: 'run', samples: session(19, () => ({ speedMps: 3, hr: 140 })) }), {}, '< 10 min after the warm-up');
  assert.deepEqual(computeStreamMetrics({ sport: 'run', samples: session(60, () => ({ speedMps: 1, hr: 110 })) }), {}, 'walking pace');
  assert.deepEqual(computeStreamMetrics({ sport: 'run', samples: [] }), {});
});

test('bike decoupling is watts per beat; it needs the power meter', () => {
  const ride = session(90, (s) => ({ powerW: 180, hr: s < 600 ? 120 : 130 + (13 * (s - 600)) / 4800 }));
  const m = computeStreamMetrics({ sport: 'bike', samples: ride });
  assert.ok(m.decouplingPct !== undefined && m.decouplingPct > 3, `decoupling ${m.decouplingPct}`);
  const noPower = computeStreamMetrics({ sport: 'bike', samples: session(90, () => ({ hr: 130, speedMps: 8 })) });
  assert.deepEqual(noPower, {});
});

// ---------------------------------------------------------------------------
// After the sync: which sessions, and what is stored
// ---------------------------------------------------------------------------

const garminDone = (id: string, overrides: Parameters<typeof workout>[0] = {}) =>
  workout({ id, status: 'completed', sport: 'run', durationMin: 60, completed: { source: 'garmin', externalId: `a-${id}`, durationMin: 60 }, ...overrides });

test('analysisCandidates: Garmin bike and run sessions ≥ 20 min not analysed yet, newest first', () => {
  const list = [
    garminDone('old', { date: '2026-10-20' }),
    garminDone('new', { date: '2026-10-24', sport: 'bike' }),
    garminDone('swim', { date: '2026-10-24', sport: 'swim' }),
    garminDone('short', { date: '2026-10-24', completed: { source: 'garmin', externalId: 'a-short', durationMin: 15 } }),
    garminDone('done', { date: '2026-10-24', completed: { source: 'garmin', externalId: 'a-done', durationMin: 60, analyzedAt: '2026-10-24T10:00:00Z' } }),
    garminDone('hk', { date: '2026-10-24', completed: { source: 'healthkit', externalId: 'HK', durationMin: 60 } }),
    workout({ id: 'planned', date: '2026-10-24', sport: 'run', durationMin: 60 }),
  ];
  assert.deepEqual(
    analysisCandidates(list).map((c) => [c.workoutId, c.activityId, c.sport]),
    [
      ['new', 'a-new', 'bike'],
      ['old', 'a-old', 'run'],
    ],
  );
  assert.equal(analysisCandidates(Array.from({ length: 9 }, (_, i) => garminDone(`w${i}`))).length, 4, 'a few per sync');
});

test('analysisPatch keeps the 1 and 20-minute bests Garmin already gave', () => {
  const patch = analysisPatch({ bestPower1MinW: 400, bestPower5MinW: 320, bestPower20MinW: 260, normalizedPowerW: 240 }, { bestPower20MinW: 262 }, 'now');
  assert.deepEqual(patch, { bestPower1MinW: 400, bestPower5MinW: 320, normalizedPowerW: 240, analyzedAt: 'now' });
});

const TOKEN: GarminToken = { accessToken: 'jwt', expiresAt: 1893456000 };

test('analyzeGarminActivities stores the metrics once; a missing file is marked, a Garmin error retried', async () => {
  const state = emptyState();
  state.workouts.push(garminDone('ok', { date: '2026-10-24' }), garminDone('gone', { date: '2026-10-23' }), garminDone('flaky', { date: '2026-10-22' }));
  const fit = encodeFit(session(60, (s) => ({ speedMps: 3, hr: s < 600 ? 130 : 140 + (12 * (s - 600)) / 3000 })));
  const seen: string[] = [];
  const api = createGarminApi(async (url) => {
    seen.push(url);
    if (url.endsWith(GARMIN_TOKEN_PATH)) return new Response('jwt');
    if (url.endsWith('/a-ok')) return new Response(zipStored('a.fit', fit) as BodyInit);
    if (url.endsWith('/a-gone')) return new Response('', { status: 404 });
    return new Response('', { status: 503 });
  }, 'https://garmin.test');
  const deps = { api, store: fakeStore(state), logger: silentLogger };
  const n = await analyzeGarminActivities(deps, { userId: USER, token: TOKEN, workouts: state.workouts, nowIso: '2026-10-24T10:00:00.000Z' });
  assert.equal(n, 2);
  const byId = (id: string) => state.workouts.find((w) => w.id === id)?.completed;
  assert.ok((byId('ok')?.hrDriftBpm ?? 0) > 5);
  assert.equal(byId('ok')?.source, 'garmin', 'the rest of completed is kept');
  assert.equal(byId('gone')?.analyzedAt, '2026-10-24T10:00:00.000Z');
  assert.equal(byId('flaky')?.analyzedAt, undefined, 'retried next sync');
  assert.ok(seen.some((u) => u === 'https://garmin.test/download-service/files/activity/a-ok'));
  seen.length = 0;
  await analyzeGarminActivities(deps, { userId: USER, token: TOKEN, workouts: state.workouts, nowIso: '2026-10-24T11:00:00.000Z' });
  assert.deepEqual(seen, ['https://garmin.test/download-service/files/activity/a-flaky'], 'only the one that failed');
});

test('the store does not write the analysis on a session linked to another activity meanwhile', async () => {
  const state = emptyState();
  state.workouts.push(garminDone('w'));
  assert.equal(await fakeStore(state).saveActivityAnalysis(USER, 'w', 'other', { decouplingPct: 3 }), false);
  assert.equal(state.workouts[0].completed?.decouplingPct, undefined);
});
