/**
 * Natural text-to-speech budget (20261105000100_speech_budget.sql): svc_reserve_speech caps each
 * user per rolling 24 h and shares one premium-voice character budget per UTC day across users.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

/** Start of the current UTC day (when Cloudflare resets the free neurons). */
const UTC_DAY_START = `(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;

describe('svc_reserve_speech (per-user limit + global premium budget per UTC day)', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;

  const reserve = async (user: string, chars: number, userLimit = 300, premiumBudget = 2500): Promise<string | null> => {
    const [row] = await t.asService<{ tier: string | null }>('select public.svc_reserve_speech($1, $2, $3, $4) as tier', [
      user,
      chars,
      userLimit,
      premiumBudget,
    ]);
    return row?.tier ?? null;
  };

  const speechRows = (user: string) =>
    t.admin<{ model: string; input_tokens: number }>(
      `select model, input_tokens from public.ai_usage where user_id = $1 and function_name = 'speech' order by id`,
      [user],
    );

  /** Inserts a `speech` row directly (e.g. in the past) without going through the function. */
  const insertSpeech = (user: string, tier: string, chars: number, createdAtSql: string) =>
    t.admin(
      `insert into public.ai_usage (user_id, function_name, model, input_tokens, created_at) values ($1, 'speech', $2, $3, ${createdAtSql})`,
      [user, tier, chars],
    );

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'speech-alice@example.com' });
    bob = await t.createUser({ email: 'speech-bob@example.com' });
  });

  beforeEach(async () => {
    await t.admin(`delete from public.ai_usage where function_name = 'speech'`);
  });

  after(async () => {
    await t.close();
  });

  test('records one ai_usage row per call with the tier as model and the characters as input_tokens', async () => {
    assert.equal(await reserve(alice, 120), 'premium');
    assert.deepEqual(await speechRows(alice), [{ model: 'premium', input_tokens: 120 }]);
  });

  test('per-user limit counts the last 24 h of speech calls only', async () => {
    assert.equal(await reserve(alice, 10, 2), 'premium');
    assert.equal(await reserve(alice, 10, 2), 'premium');
    assert.equal(await reserve(alice, 10, 2), null, 'limit reached');
    assert.equal((await speechRows(alice)).length, 2, 'a refused call inserts nothing');
    assert.equal(await reserve(bob, 10, 2), 'premium', 'the limit is per user');

    await t.admin(`insert into public.ai_usage (user_id, function_name) values ($1, 'briefing')`, [alice]);
    assert.equal(await reserve(alice, 10, 3), 'premium', 'other AI functions do not count');

    await t.admin(
      `update public.ai_usage set created_at = now() - interval '25 hours' where user_id = $1 and function_name = 'speech'`,
      [alice],
    );
    assert.equal(await reserve(alice, 10, 2), 'premium', 'calls older than 24 h fall out of the window');
  });

  test('a zero user limit refuses every call', async () => {
    assert.equal(await reserve(alice, 10, 0), null);
  });

  test('the premium budget is shared by every user; once spent, calls get the basic voice', async () => {
    assert.equal(await reserve(alice, 600, 300, 1000), 'premium');
    assert.equal(await reserve(bob, 400, 300, 1000), 'premium', 'exactly fills the budget (600 + 400 ≤ 1000)');
    assert.equal(await reserve(bob, 1, 300, 1000), 'basic', 'budget spent by both users');
    assert.equal(await reserve(alice, 1, 300, 1000), 'basic');
    assert.deepEqual(
      (await speechRows(bob)).map((r) => r.model),
      ['premium', 'basic'],
    );
  });

  test('a request that does not fit in what is left goes basic, and basic characters do not use the budget', async () => {
    assert.equal(await reserve(alice, 900, 300, 1000), 'premium');
    assert.equal(await reserve(bob, 200, 300, 1000), 'basic', '900 + 200 > 1000');
    assert.equal(await reserve(bob, 100, 300, 1000), 'premium', 'the basic row did not count: 900 + 100 ≤ 1000');
  });

  test('the premium budget resets at 00:00 UTC', async () => {
    await insertSpeech(alice, 'premium', 2000, `${UTC_DAY_START} - interval '1 second'`);
    await insertSpeech(bob, 'premium', 2000, `${UTC_DAY_START} - interval '20 hours'`);
    assert.equal(await reserve(bob, 1000, 300, 1000), 'premium', 'yesterday (UTC) premium characters do not count');

    await insertSpeech(alice, 'premium', 1, UTC_DAY_START);
    assert.equal(await reserve(alice, 1, 300, 1000), 'basic', 'a row at 00:00 UTC belongs to today: 1000 + 1 + 1 > 1000');
  });

  test('yesterday rows still count for the rolling per-user limit', async () => {
    await insertSpeech(alice, 'premium', 10, `${UTC_DAY_START} - interval '1 second'`);
    assert.equal(await reserve(alice, 10, 1), null);
  });

  test('parallel reservations cannot exceed the per-user limit', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve(alice, 10, 3)));
    assert.equal(results.filter((r) => r !== null).length, 3);
    assert.equal((await speechRows(alice)).length, 3);
  });

  test('validates input', async () => {
    await assert.rejects(t.asService(`select public.svc_reserve_speech(null, 10, 300, 2500)`), pgError({ hint: 'validation' }));
    await assert.rejects(reserve(alice, 0), pgError({ hint: 'validation' }));
    await assert.rejects(reserve(alice, 2001), pgError({ hint: 'validation' }));
    await assert.rejects(reserve(alice, 10, -1), pgError({ hint: 'validation' }));
    await assert.rejects(reserve(alice, 10, 300, -1), pgError({ hint: 'validation' }));
    await assert.rejects(
      t.asService(`select public.svc_reserve_speech(gen_random_uuid(), 10, 300, 2500)`),
      pgError({ hint: 'not_found' }),
    );
    assert.equal(await reserve(alice, 2000), 'premium', '2000 characters is the maximum accepted');
  });

  test('only service_role can execute it', async () => {
    await assert.rejects(
      t.asUser(alice, `select public.svc_reserve_speech($1, 10, 300, 2500)`, [alice]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(t.asAnon(`select public.svc_reserve_speech($1, 10, 300, 2500)`, [alice]), pgError({ code: '42501' }));
    const [privileges] = await t.admin<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.svc_reserve_speech(uuid, int, int, int)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.svc_reserve_speech(uuid, int, int, int)', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.svc_reserve_speech(uuid, int, int, int)', 'execute') as service`,
    );
    assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
  });
});
