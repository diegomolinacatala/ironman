import assert from 'node:assert/strict';
import test from 'node:test';
import { USER } from '../testing/fakes.ts';
import { authorizeToken, clientKeyOf, createRateLimiter } from './token-gate.ts';
import type { RateLimiterOptions } from './token-gate.ts';

const GOOD = 'a'.repeat(64);
const bogus = (i: number): string => `${String(i).padStart(24, '0')}${'f'.repeat(40)}`;
const T0 = 1_000_000;

function gate(opts: Partial<RateLimiterOptions> = {}) {
  const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, ...opts });
  const lookups: string[] = [];
  const resolve = async (hash: string) => {
    lookups.push(hash);
    return hash === GOOD ? USER : null;
  };
  const check = (tokenHash: string, clientKey = 'attacker', nowMs = T0) => authorizeToken(limiter, resolve, { tokenHash, clientKey, nowMs });
  return { check, lookups };
}

test('unauthenticated requests do not use up the global cap of real users', async () => {
  const g = gate({ globalLimit: 2, failureLimit: 1000 });
  for (let i = 0; i < 50; i += 1) assert.deepEqual(await g.check(bogus(i)), { ok: false, reason: 'unknown' });
  // Even one bogus token repeated past its own limit does not bump the global counter.
  for (let i = 0; i < 20; i += 1) await g.check(bogus(1));
  assert.deepEqual(await g.check(GOOD, 'user'), { ok: true, userId: USER });
});

test('unknown tokens are cached: repeated bogus tokens skip the DB lookup until the TTL ends', async () => {
  const g = gate({ negativeTtlMs: 60_000, limit: 100 });
  await g.check(bogus(7));
  await g.check(bogus(7));
  await g.check(bogus(7), 'attacker', T0 + 30_000);
  assert.equal(g.lookups.length, 1);
  await g.check(bogus(7), 'attacker', T0 + 61_000);
  assert.equal(g.lookups.length, 2);
});

test('a client over its failure budget is throttled before the lookup; other clients are not', async () => {
  const g = gate({ failureLimit: 2 });
  await g.check(bogus(1));
  await g.check(bogus(2));
  const third = await g.check(bogus(3));
  assert.equal(third.ok, false);
  assert.equal(!third.ok && third.reason, 'rate_limited');
  assert.equal(g.lookups.length, 2, 'no DB lookup once the budget is spent');
  assert.deepEqual(await g.check(GOOD, 'user'), { ok: true, userId: USER });
});

test('per-token bucket throttles only that token; the global cap applies to resolved tokens', async () => {
  const perToken = gate({ limit: 2 });
  await perToken.check(GOOD, 'user');
  await perToken.check(GOOD, 'user');
  const limited = await perToken.check(GOOD, 'user');
  assert.ok(!limited.ok && limited.reason === 'rate_limited' && limited.retryAfterSec >= 1);
  const global = gate({ limit: 10, globalLimit: 2 });
  await global.check(GOOD, 'user');
  await global.check(GOOD, 'user');
  assert.equal((await global.check(GOOD, 'user')).ok, false);
  assert.equal((await global.check(GOOD, 'user', T0 + 60_000)).ok, true, 'new window');
});

test('memory stays bounded under a flood of random tokens', async () => {
  const g = gate({ maxKeys: 50, failureLimit: 100_000, limit: 100 });
  for (let i = 0; i < 500; i += 1) await g.check(bogus(i), `ip-${i}`);
  assert.deepEqual(await g.check(GOOD, 'user'), { ok: true, userId: USER });
});

test('clientKeyOf reads the first x-forwarded-for hop', () => {
  assert.equal(clientKeyOf(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  assert.equal(clientKeyOf(new Headers({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
  assert.equal(clientKeyOf(new Headers()), 'unknown');
});
