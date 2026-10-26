import assert from 'node:assert/strict';
import test from 'node:test';
import { NOW } from '../testing/fakes.ts';
import { decodeJwtPart, generateTestP8, verifyEs256 } from '../testing/p8.ts';
import {
  APNS_PRODUCTION_HOST,
  APNS_SANDBOX_HOST,
  apnsErrorText,
  apnsPayload,
  classifyApnsResponse,
  createApnsSender,
  createProviderTokenSource,
  DEFAULT_APNS_TOPIC,
  isApnsDeviceToken,
  normalizeApnsHost,
  PROVIDER_TOKEN_TTL_MS,
  readApnsEnv,
} from './apns.ts';
import type { ApnsConfig, ApnsMessage } from './apns.ts';

const DEVICE = 'a1'.repeat(32);
const MINUTE = 60_000;

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Fake APNs: answers `status` (+ `{reason}` JSON) and records each request. */
function apnsFetch(answer: (call: Call) => { status: number; reason?: string } | Error, calls: Call[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const call: Call = { url, headers: { ...(init.headers as Record<string, string>) }, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    const a = answer(call);
    if (a instanceof Error) throw a;
    return a.status === 200 ? new Response(null, { status: 200, headers: { 'apns-id': 'x' } }) : Response.json({ reason: a.reason }, { status: a.status });
  };
}

function clock(startMs = NOW.getTime()): { now: () => Date; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => new Date(t), advance: (ms) => (t += ms) };
}

async function apnsConfig(overrides: Partial<ApnsConfig> = {}): Promise<{ config: ApnsConfig; publicKey: CryptoKey }> {
  const { pem, publicKey } = await generateTestP8();
  return { config: { keyId: 'APNSKEY123', teamId: 'TEAM123456', privateKey: pem, topic: DEFAULT_APNS_TOPIC, host: APNS_PRODUCTION_HOST, ...overrides }, publicKey };
}

const message = (overrides: Partial<ApnsMessage> = {}): ApnsMessage => ({
  deviceToken: DEVICE,
  title: 'Álex te invita',
  body: 'Rodaje el sábado',
  threadId: 'joint_invite',
  collapseId: 'n1',
  data: { url: '/joint/1', notificationId: 'n1', type: 'joint_invite' },
  ...overrides,
});

test('readApnsEnv: key id, team id and .p8 are required; topic and host have defaults', () => {
  const full: Record<string, string> = { APNS_KEY_ID: ' K1 ', APNS_TEAM_ID: 'T1', APNS_PRIVATE_KEY: 'pem' };
  assert.deepEqual(readApnsEnv((n) => full[n]), {
    ok: true,
    config: { keyId: 'K1', teamId: 'T1', privateKey: 'pem', topic: 'io.github.diegomolinacatala.ironman', host: 'api.push.apple.com' },
  });
  const sandbox = readApnsEnv((n) => ({ ...full, APNS_HOST: 'https://api.sandbox.push.apple.com/', APNS_TOPIC: 'com.x.app' })[n]);
  assert.ok(sandbox.ok);
  assert.equal(sandbox.config.host, APNS_SANDBOX_HOST);
  assert.equal(sandbox.config.topic, 'com.x.app');
  assert.deepEqual(readApnsEnv(() => undefined), { ok: false, missing: ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY'] });
  assert.deepEqual(readApnsEnv((n) => ({ ...full, APNS_HOST: 'http://evil/x' })[n]), { ok: false, missing: ['APNS_HOST'] });
  assert.equal(normalizeApnsHost('localhost:8443'), 'localhost:8443');
});

test('isApnsDeviceToken accepts raw hex tokens only', () => {
  assert.equal(isApnsDeviceToken(DEVICE), true);
  assert.equal(isApnsDeviceToken(DEVICE.toUpperCase()), true);
  assert.equal(isApnsDeviceToken('ExponentPushToken[aaaa]'), false);
  assert.equal(isApnsDeviceToken(`${DEVICE}a`), false, 'odd length');
  assert.equal(isApnsDeviceToken('ab'.repeat(16)), false, 'too short');
});

test('provider token: ES256 with {alg, kid} header and {iss, iat} claims, verifiable with the key', async () => {
  const { config, publicKey } = await apnsConfig();
  const jwt = await createProviderTokenSource(config, () => new Date(NOW.getTime() + 999)).get();
  const [header, claims] = jwt.split('.');
  assert.deepEqual(decodeJwtPart(header), { alg: 'ES256', kid: 'APNSKEY123' });
  assert.deepEqual(decodeJwtPart(claims), { iss: 'TEAM123456', iat: Math.floor(NOW.getTime() / 1000) });
  assert.equal(await verifyEs256(jwt, publicKey), true);
});

test('provider token is cached for 40 minutes and shared by concurrent sends', async () => {
  const { config } = await apnsConfig();
  const c = clock();
  const source = createProviderTokenSource(config, c.now);
  const [a, b] = await Promise.all([source.get(), source.get()]);
  assert.equal(a, b, 'one signature for concurrent callers (ECDSA signatures are randomized)');
  c.advance(PROVIDER_TOKEN_TTL_MS - MINUTE);
  assert.equal(await source.get(), a);
  c.advance(MINUTE);
  const renewed = await source.get();
  assert.notEqual(renewed, a);
  assert.equal(decodeJwtPart(renewed.split('.')[1]).iat, Math.floor((NOW.getTime() + PROVIDER_TOKEN_TTL_MS) / 1000));
  assert.ok(PROVIDER_TOKEN_TTL_MS > 20 * MINUTE && PROVIDER_TOKEN_TTL_MS < 60 * MINUTE, 'Apple: refresh between 20 and 60 minutes');
});

test('invalidate drops only the token that is still cached', async () => {
  const { config } = await apnsConfig();
  const source = createProviderTokenSource(config, clock().now);
  const first = await source.get();
  source.invalidate('some.older.token');
  assert.equal(await source.get(), first);
  source.invalidate(first);
  assert.notEqual(await source.get(), first);
});

test('the .p8 key works with escaped newlines', async () => {
  const { config, publicKey } = await apnsConfig();
  const escaped = { ...config, privateKey: config.privateKey.replace(/\n/g, '\\n') };
  assert.equal(await verifyEs256(await createProviderTokenSource(escaped, clock().now).get(), publicKey), true);
});

test('send: POST /3/device/<token> with bearer JWT, topic, alert push type and priority 10', async () => {
  const { config } = await apnsConfig({ host: APNS_SANDBOX_HOST });
  const calls: Call[] = [];
  const sender = createApnsSender({ config, fetch: apnsFetch(() => ({ status: 200 }), calls), now: clock().now });
  assert.deepEqual(await sender.send(message()), { kind: 'sent' });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, `https://api.sandbox.push.apple.com/3/device/${DEVICE}`);
  assert.match(call.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(call.headers['apns-topic'], 'io.github.diegomolinacatala.ironman');
  assert.equal(call.headers['apns-push-type'], 'alert');
  assert.equal(call.headers['apns-priority'], '10');
  assert.equal(call.headers['apns-collapse-id'], 'n1');
  const data = { url: '/joint/1', notificationId: 'n1', type: 'joint_invite' };
  assert.deepEqual(call.body, {
    ...data,
    body: data,
    aps: { alert: { title: 'Álex te invita', body: 'Rodaje el sábado' }, sound: 'default', 'thread-id': 'joint_invite' },
  });
});

test('payload: custom data never overrides aps; long texts are truncated', () => {
  const payload = apnsPayload(message({ title: 't'.repeat(500), body: 'b'.repeat(5000), data: { aps: 'x', url: '/today' } }));
  const aps = payload.aps as { alert: { title: string; body: string }; sound: string };
  assert.equal(aps.sound, 'default');
  assert.ok(aps.alert.title.length <= 120 && aps.alert.title.endsWith('…'));
  assert.ok(aps.alert.body.length <= 600);
  assert.equal(payload.url, '/today');
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length < 4096, 'APNs payload limit');
});

test('the JWT is reused across sends and re-signed after a 403', async () => {
  const { config } = await apnsConfig();
  const calls: Call[] = [];
  let status = 200;
  const sender = createApnsSender({ config, fetch: apnsFetch(() => ({ status, reason: 'ExpiredProviderToken' }), calls), now: clock().now });
  await sender.send(message());
  await sender.send(message());
  assert.equal(calls[0].headers.authorization, calls[1].headers.authorization);
  status = 403;
  assert.deepEqual(await sender.send(message()), { kind: 'auth', status: 403, reason: 'ExpiredProviderToken' });
  status = 200;
  await sender.send(message());
  assert.notEqual(calls[3].headers.authorization, calls[2].headers.authorization, 'new provider token after 403');
});

test('each APNs status class is classified', async () => {
  const cases: [number, string, string][] = [
    [200, '', 'sent'],
    [410, 'Unregistered', 'unregistered'],
    [410, 'ExpiredToken', 'unregistered'],
    [400, 'BadDeviceToken', 'unregistered'],
    [400, 'DeviceTokenNotForTopic', 'unregistered'],
    [400, 'Unregistered', 'unregistered'],
    [400, 'BadTopic', 'rejected'],
    [413, 'PayloadTooLarge', 'rejected'],
    [403, 'InvalidProviderToken', 'auth'],
    [403, 'ExpiredProviderToken', 'auth'],
    [429, 'TooManyRequests', 'retry'],
    [500, 'InternalServerError', 'retry'],
    [503, 'ServiceUnavailable', 'retry'],
  ];
  const { config } = await apnsConfig();
  for (const [status, reason, kind] of cases) {
    assert.equal(classifyApnsResponse(status, reason).kind, kind, `${status} ${reason}`);
    const sender = createApnsSender({ config, fetch: apnsFetch(() => ({ status, reason })), now: clock().now });
    const result = await sender.send(message());
    assert.equal(result.kind, kind, `sender ${status} ${reason}`);
    if (result.kind !== 'sent') assert.equal(result.reason, reason);
  }
  assert.equal(apnsErrorText({ kind: 'unregistered', status: 410, reason: 'Unregistered' }), 'APNs 410 Unregistered');
  assert.equal(apnsErrorText({ kind: 'retry', status: 0, reason: 'Timeout' }), 'APNs Timeout');
});

test('network errors and timeouts are retryable; an unusable key never reaches APNs', async () => {
  const { config } = await apnsConfig();
  const offline = createApnsSender({ config, fetch: apnsFetch(() => new TypeError('fetch failed')), now: clock().now });
  assert.deepEqual(await offline.send(message()), { kind: 'retry', status: 0, reason: 'NetworkError' });
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  const slow = createApnsSender({ config, fetch: apnsFetch(() => timeout), now: clock().now });
  assert.deepEqual(await slow.send(message()), { kind: 'retry', status: 0, reason: 'Timeout' });
  const calls: Call[] = [];
  const broken = createApnsSender({ config: { ...config, privateKey: 'not a key' }, fetch: apnsFetch(() => ({ status: 200 }), calls), now: clock().now });
  assert.deepEqual(await broken.send(message()), { kind: 'auth', status: 0, reason: 'InvalidPrivateKey' });
  assert.equal(calls.length, 0);
});
