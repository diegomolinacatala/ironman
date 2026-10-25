import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

const REQUEST = JSON.stringify({ mode: 'chat', message: 'Hola' });

describe('AI coach consent (profiles.ai_consent_at)', () => {
  let t: TestDb;
  let ana: string;
  let ben: string;

  const consentOf = async (id: string): Promise<Date | null> => {
    const [row] = await t.admin<{ ai_consent_at: Date | null }>('select ai_consent_at from public.profiles where id = $1', [id]);
    return row?.ai_consent_at ?? null;
  };

  before(async () => {
    t = await createTestDb();
    ana = await t.createUser({ email: 'ana@example.com' });
    ben = await t.createUser({ email: 'ben@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('defaults to null and is readable by the owner', async () => {
    assert.equal(await consentOf(ana), null);
    const [own] = await t.asUser<{ ai_consent_at: Date | null }>(ana, 'select ai_consent_at from public.profiles');
    assert.deepEqual(own, { ai_consent_at: null });
    const [grant] = await t.admin<{ ok: boolean }>(
      `select has_column_privilege('authenticated', 'public.profiles', 'ai_consent_at', 'UPDATE') as ok`,
    );
    assert.equal(grant?.ok, true);
  });

  test('the owner grants and withdraws consent; the server stamps the moment', async () => {
    const started = Date.now();
    await t.asUser(ana, `update public.profiles set ai_consent_at = '2001-01-01T00:00:00Z' where id = $1`, [ana]);
    const granted = await consentOf(ana);
    assert.ok(granted, 'consent stored');
    assert.ok(Math.abs(granted.getTime() - started) < 60_000, 'client value replaced by now()');

    await t.asUser(ana, `update public.profiles set ai_consent_at = '2099-01-01T00:00:00Z' where id = $1`, [ana]);
    assert.equal((await consentOf(ana))?.getTime(), granted.getTime(), 're-sending keeps the original moment');
    await t.asUser(ana, `update public.profiles set display_name = 'Ana' where id = $1`, [ana]);
    assert.equal((await consentOf(ana))?.getTime(), granted.getTime(), 'other updates leave it alone');

    await t.asUser(ana, 'update public.profiles set ai_consent_at = null where id = $1', [ana]);
    assert.equal(await consentOf(ana), null, 'withdrawn');
  });

  test("nobody can set another user's consent", async () => {
    const changed = await t.asUser(ben, 'update public.profiles set ai_consent_at = now() where id = $1 returning 1', [ana]);
    assert.equal(changed.length, 0);
    assert.equal(await consentOf(ana), null);
  });
});

describe('svc_reserve_coach_job (atomic 24 h rate limit)', () => {
  let t: TestDb;
  let user: string;

  const reserve = async (id: string, limit: number | null = null): Promise<string | null> => {
    const sql = limit === null
      ? 'select public.svc_reserve_coach_job($1, $2::jsonb) as id'
      : 'select public.svc_reserve_coach_job($1, $2::jsonb, $3) as id';
    const params = limit === null ? [id, REQUEST] : [id, REQUEST, limit];
    const [row] = await t.asService<{ id: string | null }>(sql, params);
    return row?.id ?? null;
  };

  before(async () => {
    t = await createTestDb();
    user = await t.createUser({ email: 'coach@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('inserts a running job with the request and returns its id', async () => {
    const id = await reserve(user, 3);
    assert.ok(id);
    const [job] = await t.admin<{ user_id: string; status: string; request: Record<string, unknown> }>(
      'select user_id, status, request from public.coach_jobs where id = $1',
      [id],
    );
    assert.deepEqual(job, { user_id: user, status: 'running', request: { mode: 'chat', message: 'Hola' } });
  });

  test('returns null once the limit is reached; jobs older than 24 h do not count', async () => {
    await t.admin('delete from public.coach_jobs where user_id = $1', [user]);
    for (let i = 0; i < 3; i += 1) assert.ok(await reserve(user, 3), `slot ${i + 1}`);
    assert.equal(await reserve(user, 3), null, 'limit reached');
    const [count] = await t.admin<{ n: number }>('select count(*)::int as n from public.coach_jobs where user_id = $1', [user]);
    assert.equal(count?.n, 3, 'no job inserted over the limit');

    await t.admin(`update public.coach_jobs set created_at = now() - interval '25 hours' where user_id = $1`, [user]);
    assert.ok(await reserve(user, 3), 'old jobs fall out of the window');
  });

  test('defaults to 30 jobs per day', async () => {
    await t.admin('delete from public.coach_jobs where user_id = $1', [user]);
    await t.admin(
      `insert into public.coach_jobs (user_id, request, status)
       select $1, '{}'::jsonb, 'done' from generate_series(1, 29)`,
      [user],
    );
    assert.ok(await reserve(user), '30th job');
    assert.equal(await reserve(user), null, '31st job refused');
  });

  test('serializes reservations of the same user with a transaction advisory lock', async () => {
    await t.admin('delete from public.coach_jobs where user_id = $1', [user]);
    const locks = await t.db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      await tx.query('select public.svc_reserve_coach_job($1, $2::jsonb)', [user, REQUEST]);
      const held = await tx.query<{ n: number }>(
        `select count(*)::int as n from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()`,
      );
      return held.rows[0]?.n ?? 0;
    });
    assert.equal(locks, 1, 'lock held until commit');
    const [released] = await t.admin<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
    assert.equal(released?.n, 0, 'released at commit');
  });

  test('validates input', async () => {
    await assert.rejects(
      t.asService(`select public.svc_reserve_coach_job($1, '[]'::jsonb)`, [user]),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(
      t.asService('select public.svc_reserve_coach_job(null, $1::jsonb)', [REQUEST]),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(
      t.asService('select public.svc_reserve_coach_job(gen_random_uuid(), $1::jsonb)', [REQUEST]),
      pgError({ hint: 'not_found' }),
    );
  });

  test('is not callable by signed-in users or anon', async () => {
    await assert.rejects(
      t.asUser(user, 'select public.svc_reserve_coach_job($1, $2::jsonb)', [user, REQUEST]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asAnon('select public.svc_reserve_coach_job($1, $2::jsonb)', [user, REQUEST]),
      pgError({ code: '42501' }),
    );
  });
});
