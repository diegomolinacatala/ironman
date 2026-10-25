import assert from 'node:assert/strict';
import test from 'node:test';
import { base64UrlDecode } from '../crypto.ts';
import { silentLogger } from '../log.ts';
import { createRateLimiter } from '../mcp/token-gate.ts';
import { USER } from '../testing/fakes.ts';
import { APPLE_AUDIENCE, appleConfigFromEnv, clientSecretClaims, CLIENT_SECRET_TTL_SEC, pemToDer, signClientSecret } from './client-secret.ts';
import type { AppleConfig } from './client-secret.ts';
import { handleAppleRevokeHttp } from './http.ts';
import type { AppleRevokeDeps } from './http.ts';
import { APPLE_REVOKE_URL, APPLE_TOKEN_URL, revocableToken, revokeWithAuthorizationCode } from './revoke.ts';

const decoder = new TextDecoder();
const NOW_SEC = 1_793_000_000;

async function testKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

async function config(): Promise<{ config: AppleConfig; publicKey: CryptoKey }> {
  const { pem, publicKey } = await testKey();
  return { config: { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem, clientId: 'com.diegomolinacatala.rebufo' }, publicKey };
}

const decodePart = (part: string): Record<string, unknown> => JSON.parse(decoder.decode(base64UrlDecode(part))) as Record<string, unknown>;

test('client secret claims follow Apple rules (iss team, sub bundle id, aud appleid, short exp)', () => {
  const claims = clientSecretClaims({ teamId: 'TEAM123456', clientId: 'com.x.app' }, NOW_SEC + 0.7);
  assert.deepEqual(claims, { iss: 'TEAM123456', iat: NOW_SEC, exp: NOW_SEC + CLIENT_SECRET_TTL_SEC, aud: APPLE_AUDIENCE, sub: 'com.x.app' });
  assert.ok(CLIENT_SECRET_TTL_SEC <= 15_777_000, 'Apple caps client secrets at 6 months');
});

test('signClientSecret produces an ES256 JWT verifiable with the public key', async () => {
  const { config: cfg, publicKey } = await config();
  const jwt = await signClientSecret(cfg, NOW_SEC);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(decodePart(header), { alg: 'ES256', kid: 'KEY1234567' });
  assert.equal(decodePart(payload).sub, 'com.diegomolinacatala.rebufo');
  const raw = base64UrlDecode(signature);
  assert.equal(raw.length, 64, 'raw r||s, not DER');
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, raw, new TextEncoder().encode(`${header}.${payload}`));
  assert.equal(valid, true);
});

test('the .p8 key is accepted with escaped newlines (as pasted into secrets)', async () => {
  const { pem } = await testKey();
  assert.deepEqual(pemToDer(pem.replace(/\n/g, '\\n')), pemToDer(pem));
  assert.throws(() => pemToDer('-----BEGIN PRIVATE KEY-----\nnot*base64\n-----END PRIVATE KEY-----'));
});

test('appleConfigFromEnv needs every secret and takes the first bundle id', () => {
  const full: Record<string, string> = { APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P', APPLE_CLIENT_ID: 'com.a.app, com.a.app.dev' };
  assert.deepEqual(appleConfigFromEnv((n) => full[n]), { teamId: 'T', keyId: 'K', privateKey: 'P', clientId: 'com.a.app' });
  assert.equal(appleConfigFromEnv((n) => (n === 'APPLE_KEY_ID' ? undefined : full[n])), null);
});

function appleFetch(opts: { tokenStatus?: number; tokenBody?: unknown; revokeStatus?: number } = {}, seen: { url: string; form: URLSearchParams }[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, form: new URLSearchParams(String(init.body)) });
    if (url === APPLE_TOKEN_URL) return Response.json(opts.tokenBody ?? { access_token: 'at', refresh_token: 'rt', id_token: 'x' }, { status: opts.tokenStatus ?? 200 });
    return new Response('', { status: opts.revokeStatus ?? 200 });
  };
}

test('revokeWithAuthorizationCode exchanges the code and revokes the refresh token', async () => {
  const { config: cfg } = await config();
  const seen: { url: string; form: URLSearchParams }[] = [];
  const outcome = await revokeWithAuthorizationCode(appleFetch({}, seen), cfg, 'c0de', NOW_SEC);
  assert.deepEqual(outcome, { revoked: true });
  assert.deepEqual(seen.map((s) => s.url), [APPLE_TOKEN_URL, APPLE_REVOKE_URL]);
  assert.equal(seen[0].form.get('grant_type'), 'authorization_code');
  assert.equal(seen[0].form.get('code'), 'c0de');
  assert.equal(seen[0].form.get('client_id'), 'com.diegomolinacatala.rebufo');
  assert.equal(seen[1].form.get('token'), 'rt');
  assert.equal(seen[1].form.get('token_type_hint'), 'refresh_token');
  assert.equal(seen[1].form.get('client_secret')?.split('.').length, 3);
});

test('revocation failures are reported without throwing', async () => {
  const { config: cfg } = await config();
  assert.deepEqual(await revokeWithAuthorizationCode(appleFetch({ tokenStatus: 400, tokenBody: { error: 'invalid_grant' } }), cfg, 'c', NOW_SEC), { revoked: false, reason: 'token_invalid_grant' });
  assert.deepEqual(await revokeWithAuthorizationCode(appleFetch({ revokeStatus: 400 }), cfg, 'c', NOW_SEC), { revoked: false, reason: 'revoke_http_400' });
  const offline = async (): Promise<Response> => Promise.reject(new TypeError('fetch failed'));
  assert.deepEqual(await revokeWithAuthorizationCode(offline, cfg, 'c', NOW_SEC), { revoked: false, reason: 'network' });
  assert.deepEqual(revocableToken({ access_token: 'at' }), { token: 'at', hint: 'access_token' });
  assert.equal(revocableToken({}), null);
});

async function httpDeps(overrides: Partial<AppleRevokeDeps> = {}): Promise<AppleRevokeDeps> {
  const { config: cfg } = await config();
  return {
    config: cfg,
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? USER : null),
    fetch: appleFetch(),
    rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    now: () => new Date(NOW_SEC * 1000),
    logger: silentLogger,
    ...overrides,
  };
}

const revokeReq = (body: unknown, auth = 'Bearer good'): Request =>
  new Request('https://x.supabase.co/functions/v1/apple-revoke', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('apple-revoke HTTP: 503 without secrets, 401, 400, 200 {revoked} and 429', async () => {
  const missing = await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'c' }), await httpDeps({ config: null }));
  assert.equal(missing.status, 503);
  assert.equal(((await missing.json()) as { error: string }).error, 'apple_not_configured');
  const badKey = await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'c' }), await httpDeps({ config: { teamId: 'T', keyId: 'K', privateKey: 'nope', clientId: 'b' } }));
  assert.equal(badKey.status, 503);
  assert.equal((await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'c' }, 'Bearer bad'), await httpDeps())).status, 401);
  const d = await httpDeps();
  assert.equal((await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'has space' }), d)).status, 400);
  const ok = await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'c0de' }), d);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { revoked: true });
  assert.equal((await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'c0de' }), d)).status, 429);
  const failed = await handleAppleRevokeHttp(revokeReq({ authorizationCode: 'c0de' }), await httpDeps({ fetch: appleFetch({ tokenStatus: 400 }) }));
  assert.deepEqual(await failed.json(), { revoked: false });
  assert.equal((await handleAppleRevokeHttp(new Request('https://x/apple-revoke', { method: 'GET' }), d)).status, 405);
});
