import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { USER } from '../testing/fakes.ts';
import { recorder } from '../testing/coach-fakes.ts';
import type { Recorder, RecorderOptions } from '../testing/coach-fakes.ts';
import { COACH_DAILY_LIMIT, CONSENT_REQUIRED_MESSAGE, handleCoachHttp } from './http.ts';
import type { CoachHttpDeps } from './http.ts';
import type { CoachJob } from './job.ts';

function httpDeps(overrides: Partial<CoachHttpDeps> = {}, opts: RecorderOptions = {}): CoachHttpDeps & { started: CoachJob[]; rec: Recorder } {
  const rec = recorder(opts);
  const started: CoachJob[] = [];
  return {
    aiConfigured: true,
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? USER : null),
    store: rec.store,
    startJob: (j) => started.push(j),
    logger: silentLogger,
    started,
    rec,
    ...overrides,
  };
}

const coachReq = (body: unknown, auth = 'Bearer good'): Request =>
  new Request('https://x.supabase.co/functions/v1/coach', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const chat = { mode: 'chat', weekStart: '2026-10-26' };

test('coach HTTP: 503 before creating a job when AI is not configured', async () => {
  const d = httpDeps({ aiConfigured: false });
  const res = await handleCoachHttp(coachReq(chat), d);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'ai_unavailable', message: 'El coach con IA no está configurado en el servidor. Usa el plan automático.' });
  assert.equal(d.rec.jobs.length, 0);
});

test('coach HTTP: 401, 400, 429 and 202 with jobId', async () => {
  assert.equal((await handleCoachHttp(coachReq(chat, 'Bearer bad'), httpDeps())).status, 401);
  assert.equal((await handleCoachHttp(coachReq({ mode: 'nope' }), httpDeps())).status, 400);
  const full = httpDeps({}, { jobCount: COACH_DAILY_LIMIT });
  const limited = await handleCoachHttp(coachReq(chat), full);
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { error: string }).error, 'rate_limited');
  assert.equal(full.started.length, 0);
  const d = httpDeps();
  const res = await handleCoachHttp(coachReq({ mode: 'replan', weekStart: '2026-10-28', lifeEventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), d);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { jobId: 'job-1' });
  assert.equal(d.started.length, 1);
  assert.equal(d.started[0].request.weekStart, '2026-10-26');
  assert.deepEqual(d.rec.reservations.map((r) => r.limit), [COACH_DAILY_LIMIT]);
  assert.equal((await handleCoachHttp(new Request('https://x/coach', { method: 'GET' }), httpDeps())).status, 405);
  assert.equal((await handleCoachHttp(new Request('https://x/coach', { method: 'OPTIONS' }), httpDeps())).status, 204);
});

test('coach HTTP: 403 consent_required (before reserving a job) while ai_consent_at is null', async () => {
  const d = httpDeps({}, { consentAt: null });
  const res = await handleCoachHttp(coachReq({ mode: 'plan_week', weekStart: '2026-10-26' }), d);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'consent_required', message: CONSENT_REQUIRED_MESSAGE });
  assert.equal(d.rec.reservations.length, 0);
  assert.equal(d.rec.jobs.length, 0);
  assert.equal(d.started.length, 0);
});

test('coach HTTP: concurrent requests cannot exceed the daily limit (the atomic reservation is the only gate)', async () => {
  const d = httpDeps({}, { jobCount: COACH_DAILY_LIMIT - 2 });
  const results = await Promise.all(Array.from({ length: 6 }, () => handleCoachHttp(coachReq(chat), d)));
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 202, 429, 429, 429, 429]);
  assert.equal(d.started.length, 2);
});

test('coach HTTP: store failures answer 500 without starting a job', async () => {
  const d = httpDeps();
  d.store = { ...d.store, reserveJob: async () => Promise.reject(new Error('db down')) };
  const res = await handleCoachHttp(coachReq(chat), d);
  assert.equal(res.status, 500);
  assert.equal(d.started.length, 0);
});
