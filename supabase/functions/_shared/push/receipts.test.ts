import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { fixedNow, NOW } from '../testing/fakes.ts';
import { dispatchPending } from './dispatch.ts';
import type { PushOutcome, PushStore } from './dispatch.ts';
import { EXPO_PUSH_URL, EXPO_RECEIPTS_URL } from './expo.ts';
import { handlePushHttp, pushFollowUp } from './http.ts';
import type { PushHttpDeps } from './http.ts';
import { checkReceipts, createReceiptTracker, foldReceipts, RECEIPT_MAX_AGE_MS, STALE_TOKEN_DAYS } from './receipts.ts';

const TOKEN_A = 'ExponentPushToken[aaaa]';
const TOKEN_B = 'ExponentPushToken[bbbb]';

interface Rec {
  store: PushStore;
  outcomes: PushOutcome[];
  deleted: string[];
  prunedBefore: string[];
}

function store(): Rec {
  const rec: Rec = { outcomes: [], deleted: [], prunedBefore: [], store: undefined as unknown as PushStore };
  rec.store = {
    listUnsent: async () => [{ id: 'n1', userId: 'u1', type: 'joint_invite', title: 'Álex te invita', body: 'Sábado', data: {} }],
    claim: async (ids) => ids,
    release: async () => undefined,
    listTokens: async () => [
      { token: TOKEN_A, userId: 'u1' },
      { token: TOKEN_B, userId: 'u1' },
    ],
    socialPrefs: async () => new Map(),
    recordOutcomes: async (o) => {
      rec.outcomes.push(...o);
    },
    deleteTokens: async (t) => {
      rec.deleted.push(...t);
    },
    pruneStaleTokens: async (beforeIso) => {
      rec.prunedBefore.push(beforeIso);
      return 0;
    },
  };
  return rec;
}

/** Expo fake: send → ok tickets t-<token>; getReceipts → `receipts`. */
function expo(receipts: Record<string, unknown>, calls: string[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push(url);
    if (url === EXPO_PUSH_URL) {
      const messages = JSON.parse(String(init.body)) as { to: string }[];
      return Response.json({ data: messages.map((m) => ({ status: 'ok', id: `t-${m.to}` })) });
    }
    const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
    return Response.json({ data: Object.fromEntries(ids.filter((id) => id in receipts).map((id) => [id, receipts[id]])) });
  };
}

const later = (ms: number) => (): Date => new Date(NOW.getTime() + ms);

test('receipts: DeviceNotRegistered in a receipt deletes the dead token after a successful ticket', async () => {
  const rec = store();
  const tracker = createReceiptTracker();
  const calls: string[] = [];
  const fetchFn = expo({ [`t-${TOKEN_A}`]: { status: 'ok' }, [`t-${TOKEN_B}`]: { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } }, calls);
  const summary = await dispatchPending({ store: rec.store, fetch: fetchFn, now: fixedNow, logger: silentLogger, receipts: tracker });
  assert.equal(summary.tokensRemoved, 0, 'tickets were ok: nothing removed yet');
  assert.equal(tracker.size(), 2);
  const checked = await checkReceipts({ store: rec.store, fetch: fetchFn, now: later(60_000), logger: silentLogger }, tracker);
  assert.deepEqual(rec.deleted, [TOKEN_B]);
  assert.deepEqual(checked, { checked: 2, tokensRemoved: 1, errors: 0, waiting: 0 });
  assert.ok(calls.includes(EXPO_RECEIPTS_URL));
});

test('receipts not ready yet stay tracked; old ones are dropped', async () => {
  const tracker = createReceiptTracker();
  tracker.track([{ ticketId: 'x1', token: TOKEN_A, notificationId: 'n1' }], NOW.getTime());
  const rec = store();
  const first = await checkReceipts({ store: rec.store, fetch: expo({}), now: later(60_000), logger: silentLogger }, tracker);
  assert.equal(first.waiting, 1);
  assert.equal((await checkReceipts({ store: rec.store, fetch: expo({}), now: later(1_000), logger: silentLogger }, tracker)).checked, 0, 'too recent to check');
  const expired = await checkReceipts({ store: rec.store, fetch: expo({}), now: later(RECEIPT_MAX_AGE_MS + 1), logger: silentLogger }, tracker);
  assert.equal(expired.waiting, 0);
});

test('receipt transport errors keep the tickets for the next try', async () => {
  const tracker = createReceiptTracker();
  tracker.track([{ ticketId: 'x1', token: TOKEN_A, notificationId: 'n1' }], NOW.getTime());
  const down = async (): Promise<Response> => new Response('down', { status: 503 });
  const summary = await checkReceipts({ store: store().store, fetch: down, now: later(60_000), logger: silentLogger }, tracker);
  assert.equal(summary.waiting, 1);
});

test('foldReceipts reports an error only when no device received the notification', () => {
  const base = { sentAtMs: NOW.getTime() };
  const folded = foldReceipts(
    [
      { ...base, ticketId: 'a', token: TOKEN_A, notificationId: 'n1' },
      { ...base, ticketId: 'b', token: TOKEN_B, notificationId: 'n1' },
      { ...base, ticketId: 'c', token: TOKEN_B, notificationId: 'n2' },
    ],
    new Map([
      ['a', { status: 'ok' } as const],
      ['b', { status: 'error', message: 'MessageRateExceeded', details: { error: 'MessageRateExceeded' } } as const],
      ['c', { status: 'error', message: 'MismatchSenderId' } as const],
    ]),
    NOW.getTime(),
  );
  assert.deepEqual(folded.errors, [{ id: 'n2', error: 'Recibo de Expo: MismatchSenderId' }]);
  assert.deepEqual(folded.deadTokens, []);
});

test('push HTTP schedules the follow-up; sweeps prune tokens unseen for 90 days', async () => {
  const rec = store();
  const tasks: Promise<unknown>[] = [];
  const deps: PushHttpDeps = {
    store: rec.store,
    fetch: expo({}),
    now: fixedNow,
    logger: silentLogger,
    secretKeys: ['sb_secret_x'],
    receipts: createReceiptTracker(),
    background: (t) => tasks.push(t),
    sleep: async () => undefined,
  };
  const res = await handlePushHttp(new Request('https://x/push-dispatch', { method: 'POST', headers: { apikey: 'sb_secret_x' }, body: '{"action":"sweep"}' }), deps);
  assert.equal(res.status, 200);
  await Promise.all(tasks);
  assert.deepEqual(rec.prunedBefore, [new Date(NOW.getTime() - STALE_TOKEN_DAYS * 86_400_000).toISOString()]);
  const trigger = await handlePushHttp(new Request('https://x/push-dispatch', { method: 'POST', headers: { apikey: 'sb_secret_x' }, body: '{"type":"INSERT"}' }), deps);
  assert.equal(trigger.status, 200);
  await Promise.all(tasks);
  assert.equal(rec.prunedBefore.length, 1, 'trigger calls do not prune');
  await pushFollowUp({ ...deps, store: { ...rec.store, pruneStaleTokens: async () => Promise.reject(new Error('db')) } }, true);
});
