import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger, silentLogger } from '../log.ts';
import { fixedNow, NOW } from '../testing/fakes.ts';
import { generateTestP8 } from '../testing/p8.ts';
import type { UUID } from '../types.ts';
import { APNS_PRODUCTION_HOST, createApnsSender, DEFAULT_APNS_TOPIC } from './apns.ts';
import type { ApnsMessage, ApnsResult } from './apns.ts';
import { dispatchPending, foldDeliveries, mapBounded, NOT_CONFIGURED_ERROR, toApnsMessage } from './dispatch.ts';
import type { DeviceToken, PendingNotification, PushOutcome, PushSender, PushStore } from './dispatch.ts';
import { handlePushHttp, pruneStaleTokens, STALE_TOKEN_DAYS } from './http.ts';
import type { PushHttpDeps } from './http.ts';

const TOKEN_A = 'aa'.repeat(32);
const TOKEN_B = 'bb'.repeat(32);
const TOKEN_C = 'cc'.repeat(32);

interface PushRecorder {
  store: PushStore;
  outcomes: PushOutcome[];
  released: UUID[];
  deleted: string[];
  prunedBefore: string[];
}

const DEFAULT_TOKENS: DeviceToken[] = [
  { token: TOKEN_A, userId: 'u1' },
  { token: TOKEN_B, userId: 'u1' },
  { token: TOKEN_C, userId: 'u2' },
  { token: 'ExponentPushToken[legacy]', userId: 'u3' },
];

function pushStore(
  pending: PendingNotification[],
  opts: { claimAll?: boolean; social?: Record<string, boolean>; tokens?: DeviceToken[] } = {},
): PushRecorder {
  const rec: PushRecorder = { outcomes: [], released: [], deleted: [], prunedBefore: [], store: undefined as unknown as PushStore };
  rec.store = {
    listUnsent: async () => pending,
    claim: async (ids) => (opts.claimAll === false ? ids.slice(1) : ids),
    release: async (ids) => {
      rec.released.push(...ids);
    },
    listTokens: async () => opts.tokens ?? DEFAULT_TOKENS,
    socialPrefs: async () => new Map(Object.entries(opts.social ?? {})),
    recordOutcomes: async (o) => {
      rec.outcomes.push(...o);
    },
    deleteTokens: async (t) => {
      rec.deleted.push(...t);
    },
    pruneStaleTokens: async (beforeIso) => {
      rec.prunedBefore.push(beforeIso);
      return 1;
    },
  };
  return rec;
}

const notification = (id: string, userId: string, type = 'joint_invite'): PendingNotification => ({
  id,
  userId,
  type,
  title: 'Álex te invita',
  body: 'Rodaje el sábado',
  data: { url: '/joint/1' },
});

/** Fake sender: result per device token (default sent); records every message. */
function fakeSender(results: Record<string, ApnsResult> = {}, sent: ApnsMessage[] = []): PushSender {
  return {
    send: async (m) => {
      sent.push(m);
      return results[m.deviceToken] ?? { kind: 'sent' };
    },
  };
}

const outcomeOf = (rec: PushRecorder, id: string): string | null | undefined => rec.outcomes.find((o) => o.id === id)?.error;

test('toApnsMessage carries the deep-link data, the type as thread and the id as collapse id', () => {
  assert.deepEqual(toApnsMessage(notification('n1', 'u1'), TOKEN_A), {
    deviceToken: TOKEN_A,
    title: 'Álex te invita',
    body: 'Rodaje el sábado',
    threadId: 'joint_invite',
    collapseId: 'n1',
    data: { url: '/joint/1', notificationId: 'n1', type: 'joint_invite' },
  });
});

test('dispatch sends to every iOS device, records outcomes and deletes dead tokens', async () => {
  const rec = pushStore([notification('n1', 'u1'), notification('n2', 'u2')]);
  const sent: ApnsMessage[] = [];
  const sender = fakeSender({ [TOKEN_B]: { kind: 'unregistered', status: 410, reason: 'Unregistered' }, [TOKEN_C]: { kind: 'rejected', status: 400, reason: 'BadTopic' } }, sent);
  const summary = await dispatchPending({ store: rec.store, sender, now: fixedNow, logger: silentLogger });
  assert.deepEqual(sent.map((m) => m.deviceToken).sort(), [TOKEN_A, TOKEN_B, TOKEN_C]);
  assert.deepEqual(summary, { claimed: 2, sent: 1, skipped: 0, failed: 1, requeued: 0, tokensRemoved: 1 });
  assert.deepEqual(rec.deleted, [TOKEN_B]);
  assert.equal(outcomeOf(rec, 'n1'), null, 'one delivered device is enough');
  assert.equal(outcomeOf(rec, 'n2'), 'APNs 400 BadTopic');
  assert.deepEqual(rec.released, []);
});

test('400 BadDeviceToken on the only device deletes it and records the error', async () => {
  const rec = pushStore([notification('n2', 'u2')]);
  const summary = await dispatchPending({ store: rec.store, sender: fakeSender({ [TOKEN_C]: { kind: 'unregistered', status: 400, reason: 'BadDeviceToken' } }), now: fixedNow, logger: silentLogger });
  assert.deepEqual(rec.deleted, [TOKEN_C]);
  assert.equal(outcomeOf(rec, 'n2'), 'APNs 400 BadDeviceToken');
  assert.equal(summary.tokensRemoved, 1);
});

test('social notifications respect notification_prefs.social; users without APNs tokens are skipped', async () => {
  const rec = pushStore([notification('n1', 'u1', 'kudos'), notification('n2', 'u1', 'joint_invite'), notification('n3', 'u9'), notification('n4', 'u3')], { social: { u1: false } });
  const sent: ApnsMessage[] = [];
  await dispatchPending({ store: rec.store, sender: fakeSender({}, sent), now: fixedNow, logger: silentLogger });
  assert.deepEqual(sent.map((m) => m.data.notificationId), ['n2', 'n2']);
  assert.match(outcomeOf(rec, 'n1') ?? '', /sociales desactivados/);
  assert.match(outcomeOf(rec, 'n3') ?? '', /sin dispositivos/);
  assert.match(outcomeOf(rec, 'n4') ?? '', /sin dispositivos/, 'legacy Expo tokens are ignored');
});

test('only claimed notifications are sent; 429, 5xx and network errors go back to the queue', async () => {
  const rec = pushStore([notification('n0', 'u2'), notification('n1', 'u1'), notification('n2', 'u2')], { claimAll: false });
  const sender = fakeSender({
    [TOKEN_A]: { kind: 'retry', status: 503, reason: 'ServiceUnavailable' },
    [TOKEN_B]: { kind: 'retry', status: 0, reason: 'NetworkError' },
    [TOKEN_C]: { kind: 'retry', status: 429, reason: 'TooManyRequests' },
  });
  const summary = await dispatchPending({ store: rec.store, sender, now: fixedNow, logger: silentLogger });
  assert.equal(summary.claimed, 2);
  assert.equal(summary.requeued, 2);
  assert.equal(summary.failed, 0);
  assert.deepEqual(rec.released.sort(), ['n1', 'n2']);
  assert.equal(outcomeOf(rec, 'n1'), 'APNs 503 ServiceUnavailable (se reintentará)');
  assert.equal(outcomeOf(rec, 'n2'), 'APNs 429 TooManyRequests (se reintentará)');
  const empty = pushStore([]);
  assert.equal((await dispatchPending({ store: empty.store, sender: fakeSender(), now: fixedNow, logger: silentLogger })).claimed, 0);
});

test('a 403 records push_error, logs once and puts the not-attempted notifications back in the queue', async () => {
  const rec = pushStore([notification('n1', 'u1'), notification('n2', 'u2')]);
  const sent: ApnsMessage[] = [];
  const lines: string[] = [];
  const logger = createLogger({}, (_level, line) => lines.push(line));
  const sender = fakeSender({ [TOKEN_A]: { kind: 'auth', status: 403, reason: 'InvalidProviderToken' }, [TOKEN_B]: { kind: 'auth', status: 403, reason: 'InvalidProviderToken' } }, sent);
  const summary = await dispatchPending({ store: rec.store, sender, now: fixedNow, logger, concurrency: 1 });
  assert.equal(sent.length, 1, 'nothing else is sent with a rejected provider token');
  assert.equal(outcomeOf(rec, 'n1'), 'APNs 403 InvalidProviderToken');
  assert.deepEqual(rec.released, ['n2']);
  assert.deepEqual({ failed: summary.failed, requeued: summary.requeued }, { failed: 1, requeued: 1 });
  assert.equal(lines.filter((l) => l.includes('provider token')).length, 1);
});

test('without APNS_* secrets nothing is sent and push_error is apns_not_configured', async () => {
  const rec = pushStore([notification('n1', 'u1'), notification('n2', 'u9')]);
  const summary = await dispatchPending({ store: rec.store, sender: null, now: fixedNow, logger: silentLogger });
  assert.equal(outcomeOf(rec, 'n1'), NOT_CONFIGURED_ERROR);
  assert.equal(NOT_CONFIGURED_ERROR, 'apns_not_configured');
  assert.match(outcomeOf(rec, 'n2') ?? '', /sin dispositivos/);
  assert.deepEqual(summary, { claimed: 2, sent: 0, skipped: 1, failed: 1, requeued: 0, tokensRemoved: 0 });
});

test('end to end with the real APNs sender: one JWT for the whole batch', async () => {
  const { pem } = await generateTestP8();
  const auths: string[] = [];
  const sender = createApnsSender({
    config: { keyId: 'K', teamId: 'T', privateKey: pem, topic: DEFAULT_APNS_TOPIC, host: APNS_PRODUCTION_HOST },
    fetch: async (url, init) => {
      auths.push((init.headers as Record<string, string>).authorization);
      return url.endsWith(TOKEN_B) ? Response.json({ reason: 'Unregistered' }, { status: 410 }) : new Response(null, { status: 200 });
    },
    now: fixedNow,
  });
  const rec = pushStore([notification('n1', 'u1'), notification('n2', 'u2')]);
  const summary = await dispatchPending({ store: rec.store, sender, now: fixedNow, logger: silentLogger });
  assert.equal(auths.length, 3);
  assert.equal(new Set(auths).size, 1);
  assert.deepEqual(rec.deleted, [TOKEN_B]);
  assert.equal(summary.sent, 2);
});

test('foldDeliveries: success wins, then retry, then the most telling error', () => {
  const env = (id: string, token: string) => ({ notificationId: id, message: toApnsMessage(notification(id, 'u1'), token) });
  const folded = foldDeliveries([
    { envelope: env('n1', TOKEN_A), result: { kind: 'unregistered', status: 410, reason: 'Unregistered' } },
    { envelope: env('n1', TOKEN_B), result: { kind: 'sent' } },
    { envelope: env('n2', TOKEN_A), result: { kind: 'unregistered', status: 410, reason: 'Unregistered' } },
    { envelope: env('n2', TOKEN_B), result: { kind: 'retry', status: 500, reason: 'InternalServerError' } },
    { envelope: env('n3', TOKEN_A), result: { kind: 'unregistered', status: 410, reason: 'Unregistered' } },
    { envelope: env('n3', TOKEN_B), result: { kind: 'rejected', status: 413, reason: 'PayloadTooLarge' } },
  ]);
  assert.deepEqual(folded.outcomes, [
    { id: 'n1', error: null },
    { id: 'n2', error: 'APNs 500 InternalServerError (se reintentará)' },
    { id: 'n3', error: 'APNs 413 PayloadTooLarge' },
  ]);
  assert.deepEqual(folded.requeue, ['n2']);
  assert.deepEqual(folded.deadTokens, [TOKEN_A]);
});

test('mapBounded keeps the order and never exceeds the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapBounded([5, 1, 4, 2, 3, 0], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, n));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapBounded([], 8, async (n: number) => n), []);
});

function httpDeps(rec: PushRecorder, overrides: Partial<PushHttpDeps> = {}): PushHttpDeps {
  return { store: rec.store, sender: fakeSender(), now: fixedNow, logger: silentLogger, secretKeys: ['sb_secret_x'], ...overrides };
}

const post = (body: string, apikey = 'sb_secret_x'): Request => new Request('https://x/push-dispatch', { method: 'POST', headers: { apikey }, body });

test('push HTTP requires a server key in apikey', async () => {
  const deps = httpDeps(pushStore([]));
  assert.equal((await handlePushHttp(post('{}', 'sb_publishable_x'), deps)).status, 401);
  const ok = await handlePushHttp(post('{}'), deps);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { claimed: number }).claimed, 0);
  assert.equal((await handlePushHttp(new Request('https://x/push-dispatch'), deps)).status, 405);
  assert.equal((await handlePushHttp(post('{}'), { ...deps, secretKeys: [] })).status, 500);
  const failing = httpDeps(pushStore([]), { store: { ...pushStore([]).store, listUnsent: async () => Promise.reject(new Error('db down')) } });
  assert.equal((await handlePushHttp(post('{}'), failing)).status, 500);
});

test('sweeps prune tokens unseen for 90 days in the background; trigger calls do not', async () => {
  const rec = pushStore([]);
  const tasks: Promise<unknown>[] = [];
  const deps = httpDeps(rec, { background: (t) => tasks.push(t) });
  assert.equal((await handlePushHttp(post('{"action":"sweep"}'), deps)).status, 200);
  await Promise.all(tasks);
  assert.deepEqual(rec.prunedBefore, [new Date(NOW.getTime() - STALE_TOKEN_DAYS * 86_400_000).toISOString()]);
  assert.equal((await handlePushHttp(post('{"type":"INSERT"}'), deps)).status, 200);
  assert.equal((await handlePushHttp(post('not json'), deps)).status, 200);
  await Promise.all(tasks);
  assert.equal(rec.prunedBefore.length, 1, 'trigger calls do not prune');
  await pruneStaleTokens({ ...deps, store: { ...rec.store, pruneStaleTokens: async () => Promise.reject(new Error('db')) } });
});
