/**
 * Natural text-to-speech budget (20261105000100_speech_budget.sql, replaced by
 * 20261105000200_speech_budget_caps.sql): svc_reserve_speech caps each user by characters per rolling
 * 24 h, gives each user a share of the premium-voice budget, and caps the premium and basic voices
 * per UTC day across all users.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

/** Start of the current UTC day (when Cloudflare resets the free neurons). */
const UTC_DAY_START = `(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;
const SIGNATURE = 'public.svc_reserve_speech(uuid, int, int, int, int, int)';

interface Limits {
  userDaily: number;
  userPremium: number;
  premium: number;
  basic: number;
}

/** Production defaults (supabase/functions/_shared/speech/config.ts). */
const DEFAULTS: Limits = { userDaily: 15_000, userPremium: 1_800, premium: 2_500, basic: 60_000 };

describe('svc_reserve_speech (per-user chars + per-user premium share + global premium/basic budgets per UTC day)', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;
  let carol: string;

  const reserve = async (user: string, chars: number, limits: Partial<Limits> = {}): Promise<string | null> => {
    const l = { ...DEFAULTS, ...limits };
    const [row] = await t.asService<{ tier: string | null }>(
      'select public.svc_reserve_speech($1, $2, $3, $4, $5, $6) as tier',
      [user, chars, l.userDaily, l.userPremium, l.premium, l.basic],
    );
    return row?.tier ?? null;
  };

  const speechRows = (user: string) =>
    t.admin<{ model: string; input_tokens: number }>(
      `select model, input_tokens from public.ai_usage where user_id = $1 and function_name = 'speech' order by id`,
      [user],
    );

  const allSpeechRows = async (): Promise<number> => {
    const [row] = await t.admin<{ n: number }>(`select count(*)::int as n from public.ai_usage where function_name = 'speech'`);
    return row?.n ?? 0;
  };

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
    carol = await t.createUser({ email: 'speech-carol@example.com' });
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

  test('per-user limit counts the characters (any tier) of the last 24 h', async () => {
    const limits = { userDaily: 1000, userPremium: 500 };
    assert.equal(await reserve(alice, 500, limits), 'premium');
    assert.equal(await reserve(alice, 500, limits), 'basic', 'premium share spent; basic characters count too');
    assert.equal(await reserve(alice, 1, limits), null, '1000 + 1 > 1000');
    assert.equal((await speechRows(alice)).length, 2, 'a refused call inserts nothing');
    assert.equal(await reserve(bob, 1000, { userDaily: 1000 }), 'premium', 'the limit is per user (exactly fills it)');

    await t.admin(`insert into public.ai_usage (user_id, function_name, input_tokens) values ($1, 'briefing', 5000)`, [carol]);
    assert.equal(await reserve(carol, 10, { userDaily: 10 }), 'premium', 'other AI functions do not count');

    await t.admin(
      `update public.ai_usage set created_at = now() - interval '25 hours' where user_id = $1 and function_name = 'speech'`,
      [alice],
    );
    assert.equal(await reserve(alice, 1000, { userDaily: 1000, userPremium: 1000 }), 'premium', 'characters older than 24 h fall out of the window');
  });

  test('a zero user limit refuses every call', async () => {
    assert.equal(await reserve(alice, 1, { userDaily: 0 }), null);
    assert.equal(await allSpeechRows(), 0);
  });

  test('each user gets a share of the premium budget: a second user still gets premium after the first spent theirs', async () => {
    const limits = { userPremium: 1000, premium: 2500 };
    assert.equal(await reserve(alice, 600, limits), 'premium');
    assert.equal(await reserve(alice, 400, limits), 'premium', 'exactly fills her share');
    assert.equal(await reserve(alice, 1, limits), 'basic', 'her premium share is spent');
    assert.equal(await reserve(bob, 1000, limits), 'premium', 'bob has his own share');
    assert.equal(await reserve(carol, 500, limits), 'premium', 'global 2000 + 500 ≤ 2500');
    assert.equal(await reserve(carol, 1, limits), 'basic', 'global premium budget spent');
    assert.deepEqual(
      (await speechRows(alice)).map((r) => r.model),
      ['premium', 'premium', 'basic'],
    );
  });

  test('the premium budget is shared by every user; once spent, calls get the basic voice', async () => {
    const limits = { premium: 1000 };
    assert.equal(await reserve(alice, 600, limits), 'premium');
    assert.equal(await reserve(bob, 400, limits), 'premium', 'exactly fills the budget (600 + 400 ≤ 1000)');
    assert.equal(await reserve(bob, 1, limits), 'basic', 'budget spent by both users');
    assert.equal(await reserve(alice, 1, limits), 'basic');
    assert.deepEqual(
      (await speechRows(bob)).map((r) => r.model),
      ['premium', 'basic'],
    );
  });

  test('a request that does not fit in what is left goes basic, and basic characters do not use the premium budget', async () => {
    const limits = { premium: 1000, userPremium: 1000 };
    assert.equal(await reserve(alice, 900, limits), 'premium');
    assert.equal(await reserve(bob, 200, limits), 'basic', '900 + 200 > 1000');
    assert.equal(await reserve(bob, 100, limits), 'premium', 'the basic row did not count: 900 + 100 ≤ 1000');
  });

  test('the basic voice has a global daily cap too: once both budgets are spent the call is refused', async () => {
    const limits = { premium: 0, basic: 1000 };
    assert.equal(await reserve(alice, 600, limits), 'basic', 'premium budget 0 = always basic');
    assert.equal(await reserve(bob, 400, limits), 'basic', 'exactly fills the basic budget');
    assert.equal(await reserve(bob, 1, limits), null, 'basic budget spent by both users');
    assert.equal(await reserve(carol, 1, limits), null, 'a fresh user is refused too');
    assert.equal(await allSpeechRows(), 2, 'refused calls insert nothing');
    assert.equal(await reserve(carol, 1, { premium: 1, basic: 1000 }), 'premium', 'premium left still serves');
  });

  test('premium, basic and per-user premium budgets reset at 00:00 UTC', async () => {
    const roomy = { userDaily: 1_000_000 };
    await insertSpeech(alice, 'premium', 1800, `${UTC_DAY_START} - interval '1 second'`);
    await insertSpeech(bob, 'premium', 700, `${UTC_DAY_START} - interval '1 second'`);
    await insertSpeech(bob, 'basic', 60_000, `${UTC_DAY_START} - interval '1 second'`);

    assert.equal(await reserve(alice, 1800, roomy), 'premium', 'yesterday (UTC) premium characters do not use her share nor the budget');
    assert.equal(await reserve(bob, 700, roomy), 'premium', 'global 1800 + 700 ≤ 2500');
    assert.equal(await reserve(bob, 1, roomy), 'basic', 'yesterday (UTC) basic characters do not count');

    await insertSpeech(carol, 'basic', 59_999, UTC_DAY_START);
    assert.equal(await reserve(carol, 1, roomy), null, 'a row at 00:00 UTC belongs to today: 1 + 59999 + 1 > 60000');
  });

  test('yesterday rows still count for the rolling per-user limit', async () => {
    await insertSpeech(alice, 'premium', 1000, `${UTC_DAY_START} - interval '1 second'`);
    assert.equal(await reserve(alice, 1, { userDaily: 1000 }), null);
  });

  test('parallel reservations cannot exceed the per-user limit', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve(alice, 10, { userDaily: 30 })));
    assert.equal(results.filter((r) => r !== null).length, 3);
    assert.equal((await speechRows(alice)).length, 3);
  });

  test('parallel reservations of several users cannot exceed the global budgets', async () => {
    const limits = { userPremium: 1000, premium: 1000, basic: 400 };
    const users = [alice, bob, carol];
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve(users[i % 3] ?? alice, 200, limits)));
    assert.equal(results.filter((r) => r === 'premium').length, 5);
    assert.equal(results.filter((r) => r === 'basic').length, 2);
    assert.equal(results.filter((r) => r === null).length, 5);
    assert.equal(await allSpeechRows(), 7);
  });

  test('validates input', async () => {
    await assert.rejects(
      t.asService(`select public.svc_reserve_speech(null, 10, 15000, 1800, 2500, 60000)`),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(reserve(alice, 0), pgError({ hint: 'validation' }));
    await assert.rejects(reserve(alice, 2001), pgError({ hint: 'validation' }));
    for (const key of ['userDaily', 'userPremium', 'premium', 'basic'] as const) {
      await assert.rejects(reserve(alice, 10, { [key]: -1 }), pgError({ hint: 'validation' }), `${key} < 0`);
    }
    await assert.rejects(
      t.asService(`select public.svc_reserve_speech($1, 10, null, 1800, 2500, 60000)`, [alice]),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(
      t.asService(`select public.svc_reserve_speech($1, 10, 15000, 1800, 2500, null)`, [alice]),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(
      t.asService(`select public.svc_reserve_speech(gen_random_uuid(), 10, 15000, 1800, 2500, 60000)`),
      pgError({ hint: 'not_found' }),
    );
    assert.equal(await reserve(alice, 2000, { userPremium: 2000 }), 'premium', '2000 characters is the maximum accepted');
    assert.equal(await allSpeechRows(), 1);
  });

  test('the old 4-argument overload is gone', async () => {
    const rows = await t.admin<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'svc_reserve_speech'`,
    );
    assert.deepEqual(rows, [
      {
        args: 'p_user uuid, p_chars integer, p_user_daily_chars integer, p_user_premium_chars integer, p_premium_budget integer, p_basic_budget integer',
      },
    ]);
    await assert.rejects(
      t.asService(`select public.svc_reserve_speech($1, 10, 300, 2500)`, [alice]),
      pgError({ code: '42883' }),
    );
  });

  test('only service_role can execute it', async () => {
    await assert.rejects(
      t.asUser(alice, `select public.svc_reserve_speech($1, 10, 15000, 1800, 2500, 60000)`, [alice]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asAnon(`select public.svc_reserve_speech($1, 10, 15000, 1800, 2500, 60000)`, [alice]),
      pgError({ code: '42501' }),
    );
    const [privileges] = await t.admin<{ anon: boolean; authenticated: boolean; public: boolean; service: boolean }>(
      `select has_function_privilege('anon', '${SIGNATURE}', 'execute') as anon,
              has_function_privilege('authenticated', '${SIGNATURE}', 'execute') as authenticated,
              exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.oid = '${SIGNATURE}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public,
              has_function_privilege('service_role', '${SIGNATURE}', 'execute') as service`,
    );
    assert.deepEqual(privileges, { anon: false, authenticated: false, public: false, service: true });
  });
});
