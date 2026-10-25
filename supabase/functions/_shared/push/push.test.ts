import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { fixedNow } from '../testing/fakes.ts';
import type { UUID } from '../types.ts';
import { dispatchPending, summarizeTickets, toExpoMessage } from './dispatch.ts';
import type { PendingNotification, PushOutcome, PushStore } from './dispatch.ts';
import { chunk, EXPO_PUSH_URL } from './expo.ts';
import type { ExpoMessage } from './expo.ts';
import { handlePushHttp } from './http.ts';

const TOKEN_A = 'ExponentPushToken[aaaa]';
const TOKEN_B = 'ExponentPushToken[bbbb]';

interface PushRecorder {
  store: PushStore;
  outcomes: PushOutcome[];
  released: UUID[];
  deleted: string[];
  prunedBefore: string[];
}

function pushStore(pending: PendingNotification[], opts: { claimAll?: boolean; social?: Record<string, boolean> } = {}): PushRecorder {
  const rec: PushRecorder = { outcomes: [], released: [], deleted: [], prunedBefore: [], store: undefined as unknown as PushStore };
  rec.store = {
    listUnsent: async () => pending,
    claim: async (ids) => (opts.claimAll === false ? ids.slice(1) : ids),
    release: async (ids) => {
      rec.released.push(...ids);
    },
    listTokens: async () => [
      { token: TOKEN_A, userId: 'u1' },
      { token: TOKEN_B, userId: 'u1' },
      { token: 'ExponentPushToken[cccc]', userId: 'u2' },
      { token: 'not-an-expo-token', userId: 'u3' },
    ],
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

function expoFetch(handler: (messages: ExpoMessage[]) => Response, calls: { url: string; init: RequestInit }[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return handler(JSON.parse(String(init.body)) as ExpoMessage[]);
  };
}

test('chunk splits in groups of 100 and messages carry deep-link data', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(chunk(Array.from({ length: 250 }), 100).length, 3);
  const m = toExpoMessage(notification('n1', 'u1'), TOKEN_A);
  assert.deepEqual(m, { to: TOKEN_A, title: 'Álex te invita', body: 'Rodaje el sábado', data: { url: '/joint/1', notificationId: 'n1', type: 'joint_invite' }, sound: 'default' });
});

test('dispatch sends to every device, records outcomes and removes DeviceNotRegistered tokens', async () => {
  const rec = pushStore([notification('n1', 'u1'), notification('n2', 'u2')]);
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = expoFetch(
    (messages) =>
      Response.json({
        data: messages.map((m) =>
          m.to === TOKEN_B ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } : m.to === TOKEN_A ? { status: 'ok', id: 't1' } : { status: 'error', message: 'MessageTooBig' },
        ),
      }),
    calls,
  );
  const summary = await dispatchPending({ store: rec.store, fetch: fetchFn, expoAccessToken: 'expo-token', now: fixedNow, logger: silentLogger });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXPO_PUSH_URL);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer expo-token');
  assert.equal(summary.claimed, 2);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(rec.deleted, [TOKEN_B]);
  assert.deepEqual(rec.outcomes.find((o) => o.id === 'n1'), { id: 'n1', error: null });
  assert.equal(rec.outcomes.find((o) => o.id === 'n2')?.error, 'MessageTooBig');
});

test('social notifications respect notification_prefs.social; users without tokens are skipped', async () => {
  const rec = pushStore([notification('n1', 'u1', 'kudos'), notification('n2', 'u1', 'joint_invite'), notification('n3', 'u9')], { social: { u1: false } });
  const seen: ExpoMessage[][] = [];
  await dispatchPending({
    store: rec.store,
    fetch: expoFetch((messages) => {
      seen.push(messages);
      return Response.json({ data: messages.map(() => ({ status: 'ok', id: 'x' })) });
    }),
    now: fixedNow,
    logger: silentLogger,
  });
  assert.deepEqual(seen[0].map((m) => m.data.notificationId), ['n2', 'n2']);
  assert.match(rec.outcomes.find((o) => o.id === 'n1')?.error ?? '', /sociales desactivados/);
  assert.match(rec.outcomes.find((o) => o.id === 'n3')?.error ?? '', /sin dispositivos/);
});

test('only claimed notifications are sent; transient Expo failures are released for retry', async () => {
  const rec = pushStore([notification('n1', 'u1'), notification('n2', 'u2')], { claimAll: false });
  const summary = await dispatchPending({ store: rec.store, fetch: expoFetch(() => new Response('down', { status: 503 })), now: fixedNow, logger: silentLogger });
  assert.equal(summary.claimed, 1);
  assert.equal(summary.requeued, 1);
  assert.deepEqual(rec.released, ['n2']);
  const empty = pushStore([]);
  assert.equal((await dispatchPending({ store: empty.store, fetch: expoFetch(() => Response.json({})), now: fixedNow, logger: silentLogger })).claimed, 0);
});

test('summarizeTickets: one success among devices is a success', () => {
  const envs = [
    { notificationId: 'n1', message: toExpoMessage(notification('n1', 'u1'), TOKEN_A) },
    { notificationId: 'n1', message: toExpoMessage(notification('n1', 'u1'), TOKEN_B) },
  ];
  const r = summarizeTickets(envs, [{ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }, { status: 'ok', id: '1' }]);
  assert.deepEqual(r.outcomes, [{ id: 'n1', error: null }]);
  assert.deepEqual(r.deadTokens, [TOKEN_A]);
});

test('push HTTP requires a server key in apikey', async () => {
  const rec = pushStore([]);
  const deps = { store: rec.store, fetch: expoFetch(() => Response.json({})), now: fixedNow, logger: silentLogger, secretKeys: ['sb_secret_x'] };
  const denied = await handlePushHttp(new Request('https://x/push-dispatch', { method: 'POST', headers: { apikey: 'sb_publishable_x' } }), deps);
  assert.equal(denied.status, 401);
  const ok = await handlePushHttp(new Request('https://x/push-dispatch', { method: 'POST', headers: { apikey: 'sb_secret_x' }, body: '{}' }), deps);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { claimed: number }).claimed, 0);
  assert.equal((await handlePushHttp(new Request('https://x/push-dispatch'), deps)).status, 405);
  assert.equal((await handlePushHttp(new Request('https://x/push-dispatch', { method: 'POST' }), { ...deps, secretKeys: [] })).status, 500);
});
