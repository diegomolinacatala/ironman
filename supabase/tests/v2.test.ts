/**
 * v2 migration (20261027000100_v2.sql): sleep stages on daily_metrics, server-written briefings
 * (read own, no client writes), coach_jobs.extras and the onboarding reset.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, migrationFiles, pgError, readSupabaseFile } from './harness.ts';
import type { TestDb } from './harness.ts';

const V2 = '20261027000100_v2.sql';

const SLEEP = JSON.stringify({ hours: 7.33, score: 81, deepMin: 82, lightMin: 250, remMin: 95, awakeMin: 13 });

async function insertBriefing(t: TestDb, userId: string, date: string, headline = 'Dormiste 7 h 20′'): Promise<void> {
  await t.asService(
    `insert into public.briefings (user_id, date, headline, sleep_verdict, sleep_summary, script, focus, sleep, model)
     values ($1, $2, $3, 'good', 'Buena noche.', 'Buenos días.', 'Hidrátate.', $4::jsonb, 'claude-opus-5-5')`,
    [userId, date, headline, SLEEP],
  );
}

describe('v2: briefings', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'v2-alice@example.com' });
    bob = await t.createUser({ email: 'v2-bob@example.com' });
    await insertBriefing(t, alice, isoDay(0));
    await insertBriefing(t, bob, isoDay(0), 'Bob');
  });

  after(async () => {
    await t.close();
  });

  test('a user selects only their own briefings', async () => {
    const mine = await t.asUser<{ user_id: string; headline: string; sleep: { deepMin: number } }>(alice, 'select * from public.briefings');
    assert.equal(mine.length, 1);
    assert.equal(mine[0]?.user_id, alice);
    assert.equal(mine[0]?.sleep.deepMin, 82, 'sleep snapshot is stored verbatim (camelCase)');
    const bobs = await t.asUser<{ headline: string }>(bob, 'select headline from public.briefings');
    assert.deepEqual(bobs.map((b) => b.headline), ['Bob']);
  });

  test('users cannot insert, update or delete briefings (service role only)', async () => {
    await assert.rejects(
      t.asUser(alice, `insert into public.briefings (user_id, date, headline, script) values ($1, $2, 'X', 'Y')`, [alice, isoDay(1)]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(t.asUser(alice, `update public.briefings set headline = 'Hack'`), pgError({ code: '42501' }));
    await assert.rejects(t.asUser(alice, 'delete from public.briefings'), pgError({ code: '42501' }));
    await assert.rejects(t.asAnon('select * from public.briefings'), pgError({ code: '42501' }));
  });

  test('the service role upserts one row per (user, date) and the checks hold', async () => {
    await t.asService(
      `insert into public.briefings (user_id, date, headline, script) values ($1, $2, 'Nuevo', 'Otro guion')
       on conflict (user_id, date) do update set headline = excluded.headline, script = excluded.script`,
      [alice, isoDay(0)],
    );
    const [row] = await t.admin<{ headline: string; sleep_verdict: string; n: number }>(
      `select headline, sleep_verdict, (select count(*)::int from public.briefings where user_id = $1) as n
       from public.briefings where user_id = $1 and date = $2`,
      [alice, isoDay(0)],
    );
    assert.equal(row?.headline, 'Nuevo');
    assert.equal(row?.n, 1);
    await assert.rejects(
      t.asService(`insert into public.briefings (user_id, date, headline, script, sleep_verdict) values ($1, $2, 'X', 'Y', 'meh')`, [alice, isoDay(2)]),
      pgError({ code: '23514' }),
    );
    await assert.rejects(
      t.asService(`insert into public.briefings (user_id, date, headline, script) values ($1, $2, $3, 'Y')`, [alice, isoDay(3), 'x'.repeat(121)]),
      pgError({ code: '23514' }),
    );
  });

  test('briefings disappear with the account', async () => {
    const carol = await t.createUser({ email: 'v2-carol@example.com' });
    await insertBriefing(t, carol, isoDay(0));
    await t.admin('delete from auth.users where id = $1', [carol]);
    const left = await t.admin('select 1 from public.briefings where user_id = $1', [carol]);
    assert.equal(left.length, 0);
  });
});

describe('v2: daily_metrics sleep stages and coach_jobs.extras', () => {
  let t: TestDb;
  let alice: string;

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'v2-metrics@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('owners write sleep stages and start/end; out-of-range minutes are rejected', async () => {
    await t.asUser(
      alice,
      `insert into public.daily_metrics (date, source, sleep_deep_min, sleep_light_min, sleep_rem_min, sleep_awake_min, sleep_start, sleep_end)
       values ($1, 'healthkit', 80, 250, 95, 12, '2026-10-26T22:40:00Z', '2026-10-27T06:20:00Z')`,
      [isoDay(0)],
    );
    const [row] = await t.asUser<{ sleep_deep_min: number; sleep_end: Date }>(alice, 'select sleep_deep_min, sleep_end from public.daily_metrics');
    assert.equal(row?.sleep_deep_min, 80);
    assert.equal(new Date(row?.sleep_end ?? 0).toISOString(), '2026-10-27T06:20:00.000Z');
    await assert.rejects(
      t.asUser(alice, `insert into public.daily_metrics (date, source, sleep_rem_min) values ($1, 'garmin', 1441)`, [isoDay(-1)]),
      pgError({ code: '23514' }),
    );
  });

  test('coach_jobs.extras holds an object, is readable by the owner and not writable', async () => {
    await t.admin(
      `insert into public.coach_jobs (user_id, request, status, extras) values ($1, '{}', 'done', $2::jsonb)`,
      [alice, JSON.stringify({ memory: ['Prefiere nadar por la mañana'], lifeEventId: null })],
    );
    const [job] = await t.asUser<{ extras: { memory: string[]; lifeEventId: string | null } }>(alice, 'select extras from public.coach_jobs');
    assert.deepEqual(job?.extras, { memory: ['Prefiere nadar por la mañana'], lifeEventId: null });
    await assert.rejects(t.asUser(alice, `update public.coach_jobs set extras = '{}'`), pgError({ code: '42501' }));
    await assert.rejects(
      t.admin(`insert into public.coach_jobs (user_id, request, extras) values ($1, '{}', '[]'::jsonb)`, [alice]),
      pgError({ code: '23514' }),
    );
  });
});

describe('v2: onboarding reset on upgrade', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb({ migrate: false });
    for (const name of migrationFiles().filter((n) => n < V2)) {
      await t.db.exec(readSupabaseFile(`migrations/${name}`));
    }
  });

  after(async () => {
    await t.close();
  });

  test('existing users see the v2 onboarding and the AI consent again; re-running never resets newer ones', async () => {
    const v1 = await t.createUser({ email: 'v1-user@example.com' });
    const consentOnly = await t.createUser({ email: 'v1-consent@example.com' });
    /** Writes historic timestamps (the consent trigger would stamp now()). */
    const setDates = async (id: string, onboardedAt: string | null, consentAt: string | null): Promise<void> => {
      await t.admin('alter table public.profiles disable trigger profiles_ai_consent');
      await t.admin('update public.profiles set onboarded_at = $2, ai_consent_at = $3 where id = $1', [id, onboardedAt, consentAt]);
      await t.admin('alter table public.profiles enable trigger profiles_ai_consent');
    };
    const dates = async (id: string): Promise<[string | null, string | null]> => {
      const [row] = await t.admin<{ onboarded_at: Date | null; ai_consent_at: Date | null }>(
        'select onboarded_at, ai_consent_at from public.profiles where id = $1',
        [id],
      );
      const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
      return [iso(row?.onboarded_at), iso(row?.ai_consent_at)];
    };
    await setDates(v1, '2026-10-20T10:00:00Z', '2026-10-21T10:00:00Z');
    await setDates(consentOnly, null, '2026-10-22T10:00:00Z');
    for (const name of migrationFiles().filter((n) => n >= V2)) {
      await t.db.exec(readSupabaseFile(`migrations/${name}`));
    }
    assert.deepEqual(await dates(v1), [null, null]);
    assert.deepEqual(await dates(consentOnly), [null, null], 'consent naming Anthropic is asked again');

    // Someone who went through the v2 onboarding after the release keeps it when the migration runs again.
    await setDates(v1, '2026-11-02T10:00:00Z', '2026-11-02T09:00:00Z');
    await t.db.exec(readSupabaseFile(`migrations/${V2}`));
    assert.deepEqual(await dates(v1), ['2026-11-02T10:00:00.000Z', '2026-11-02T09:00:00.000Z']);
    const cols = await t.admin<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'daily_metrics' and column_name like 'sleep\\_%' order by 1`,
    );
    assert.deepEqual(cols.map((c) => c.column_name), [
      'sleep_awake_min',
      'sleep_deep_min',
      'sleep_end',
      'sleep_hours',
      'sleep_light_min',
      'sleep_rem_min',
      'sleep_score',
      'sleep_start',
    ]);
  });
});

describe('svc_reserve_ai_call (atomic 24 h limit for briefing / meal)', () => {
  let t: TestDb;
  let user: string;

  const reserve = async (fn: string, limit: number, id = user): Promise<string | null> => {
    const [row] = await t.asService<{ id: string | null }>('select public.svc_reserve_ai_call($1, $2, $3)::text as id', [id, fn, limit]);
    return row?.id ?? null;
  };

  before(async () => {
    t = await createTestDb();
    user = await t.createUser({ email: 'v2-ai@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('inserts a provisional ai_usage row per call and refuses once the limit is reached', async () => {
    const first = await reserve('briefing', 2);
    assert.ok(first);
    const [row] = await t.admin<{ user_id: string; function_name: string; model: string | null }>(
      'select user_id, function_name, model from public.ai_usage where id = $1',
      [first],
    );
    assert.deepEqual(row, { user_id: user, function_name: 'briefing', model: null });
    assert.ok(await reserve('briefing', 2));
    assert.equal(await reserve('briefing', 2), null, 'limit reached (failed calls stay counted)');
    assert.ok(await reserve('meal', 2), 'limits are per function');
    await t.admin(`update public.ai_usage set created_at = now() - interval '25 hours' where user_id = $1 and function_name = 'briefing'`, [user]);
    assert.ok(await reserve('briefing', 2), 'calls older than 24 h fall out of the window');
  });

  test('parallel reservations cannot exceed the limit', async () => {
    const other = await t.createUser({ email: 'v2-ai-race@example.com' });
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve('meal', 3, other)));
    assert.equal(results.filter(Boolean).length, 3);
    const [count] = await t.admin<{ n: number }>(`select count(*)::int as n from public.ai_usage where user_id = $1`, [other]);
    assert.equal(count?.n, 3);
  });

  test('validates input and is service-role only', async () => {
    await assert.rejects(t.asService(`select public.svc_reserve_ai_call(null, 'meal', 3)`), pgError({ hint: 'validation' }));
    await assert.rejects(t.asService(`select public.svc_reserve_ai_call($1, 'Meal; drop', 3)`, [user]), pgError({ hint: 'validation' }));
    await assert.rejects(t.asService(`select public.svc_reserve_ai_call($1, 'meal', -1)`, [user]), pgError({ hint: 'validation' }));
    await assert.rejects(t.asService(`select public.svc_reserve_ai_call(gen_random_uuid(), 'meal', 3)`), pgError({ hint: 'not_found' }));
    await assert.rejects(t.asUser(user, `select public.svc_reserve_ai_call($1, 'meal', 3)`, [user]), pgError({ code: '42501' }));
    await assert.rejects(t.asAnon(`select public.svc_reserve_ai_call($1, 'meal', 3)`, [user]), pgError({ code: '42501' }));
  });
});
