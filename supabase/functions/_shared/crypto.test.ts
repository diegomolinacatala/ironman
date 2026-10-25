import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  jwtExpiration,
  sha256Hex,
} from './crypto.ts';

test('sha256Hex matches Node crypto (and therefore Postgres sha256 hex)', async () => {
  const secret = `rb_${'ab'.repeat(32)}`;
  assert.equal(await sha256Hex(secret), createHash('sha256').update(secret, 'utf8').digest('hex'));
  assert.equal(await sha256Hex('ñandú'), createHash('sha256').update('ñandú', 'utf8').digest('hex'));
});

test('constantTimeEqual compares full strings', () => {
  assert.equal(constantTimeEqual('sb_secret_abc', 'sb_secret_abc'), true);
  assert.equal(constantTimeEqual('sb_secret_abc', 'sb_secret_abd'), false);
  assert.equal(constantTimeEqual('short', 'shorter'), false);
  assert.equal(constantTimeEqual('', ''), true);
});

test('base64url round trip', () => {
  const bytes = new Uint8Array([0, 255, 62, 63, 128]);
  assert.deepEqual([...base64UrlDecode(base64UrlEncode(bytes))], [...bytes]);
  assert.equal(base64UrlEncode(new Uint8Array([251, 255])), '-_8');
});

test('AES-GCM encryption is bound to the secret and the context', async () => {
  const secret = 'a-very-long-server-secret-123456';
  const payload = await encryptSecret('garmin-key-XYZ', secret, 'garmin_personal:user-1');
  assert.match(payload, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!payload.includes('garmin-key-XYZ'));
  assert.equal(await decryptSecret(payload, secret, 'garmin_personal:user-1'), 'garmin-key-XYZ');
  await assert.rejects(decryptSecret(payload, secret, 'garmin_personal:user-2'));
  await assert.rejects(decryptSecret(payload, 'another-long-server-secret-0000', 'garmin_personal:user-1'));
  await assert.rejects(decryptSecret('v0.x.y', secret, 'ctx'));
  await assert.rejects(encryptSecret('x', 'short', 'ctx'));
  const again = await encryptSecret('garmin-key-XYZ', secret, 'garmin_personal:user-1');
  assert.notEqual(again, payload, 'random IV per encryption');
});

test('jwtExpiration reads exp without verifying', () => {
  const part = (o: unknown): string => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const jwt = `${part({ alg: 'none' })}.${part({ exp: 1893456000 })}.sig`;
  assert.equal(jwtExpiration(jwt), 1893456000);
  assert.equal(jwtExpiration('not-a-jwt'), null);
  assert.equal(jwtExpiration(`${part({})}.${part({ sub: 'x' })}.s`), null);
});
