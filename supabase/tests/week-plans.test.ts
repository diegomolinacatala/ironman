/**
 * v4 general plan (20261109000100_coach_v4.sql §4): week_plans holds one entry per user and Monday
 * for Plan → General. Own-rows RLS for the app, service-role writes for the coach and Claude
 * (set_week_plans), checks on every column, upsert by week, keep_owner and cascade with the account.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoMonday, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface WeekPlanRow {
  user_id: string;
  week_start: string;
  kind: string;
  target_minutes: number | null;
  note: string | null;
  source: string;
}

interface PlanInput {
  minutes?: number | null;
  note?: string | null;
  source?: string;
}

const COLUMNS = 'user_id, week_start::text as week_start, kind, target_minutes, note, source';

/** The app's save (saveWeekPlans): one row per (user, Monday); a later save replaces the entry. */
const UPSERT = `
  insert into public.week_plans (week_start, kind, target_minutes, note, source)
  values ($1, $2, $3, $4, $5)
  on conflict (user_id, week_start) do update set
    kind = excluded.kind,
    target_minutes = excluded.target_minutes,
    note = excluded.note,
    source = excluded.source
  returning ${COLUMNS}`;

describe('week_plans (Plan → General)', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;

  const upsert = async (user: string, week: string, kind: string, input: PlanInput = {}): Promise<WeekPlanRow> => {
    const params = [week, kind, input.minutes ?? null, input.note ?? null, input.source ?? 'manual'];
    const [row] = await t.asUser<WeekPlanRow>(user, UPSERT, params);
    assert.ok(row, 'upsert returned the row');
    return row;
  };
  const rowsOf = (user: string): Promise<WeekPlanRow[]> =>
    t.admin<WeekPlanRow>(`select ${COLUMNS} from public.week_plans where user_id = $1 order by week_start`, [user]);

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'wp-alice@example.com' });
    bob = await t.createUser({ email: 'wp-bob@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('owners write their weeks (user_id defaults to auth.uid()); other users see and change nothing', async () => {
    const week = isoMonday(1);
    const created = await upsert(alice, week, 'recovery', { minutes: 300, note: 'Viaje a Londres: solo carrera' });
    assert.deepEqual(created, {
      user_id: alice,
      week_start: week,
      kind: 'recovery',
      target_minutes: 300,
      note: 'Viaje a Londres: solo carrera',
      source: 'manual',
    });

    assert.deepEqual(await t.asUser(bob, 'select * from public.week_plans'), [], 'bob sees none of alice weeks');
    const changed = await t.asUser(bob, `update public.week_plans set kind = 'push' where week_start = $1 returning 1`, [week]);
    assert.equal(changed.length, 0, 'bob cannot update');
    const removed = await t.asUser(bob, 'delete from public.week_plans where week_start = $1 returning 1', [week]);
    assert.equal(removed.length, 0, 'bob cannot delete');
    await assert.rejects(
      t.asUser(bob, `insert into public.week_plans (user_id, week_start, kind) values ($1, $2, 'rest')`, [alice, isoMonday(2)]),
      pgError({ code: '42501' }),
      'bob cannot insert weeks owned by alice',
    );
    await assert.rejects(
      t.asUser(alice, 'update public.week_plans set user_id = $2 where week_start = $1', [week, bob]),
      pgError({ code: '42501' }),
      'alice cannot hand a week over to bob',
    );
    await assert.rejects(t.asAnon('select * from public.week_plans'), pgError({ code: '42501' }));

    // The same Monday is a separate row for each athlete.
    await upsert(bob, week, 'push');
    assert.deepEqual((await rowsOf(alice)).map((r) => r.kind), ['recovery']);
    const bobs = await t.asUser<WeekPlanRow>(bob, `select ${COLUMNS} from public.week_plans`);
    assert.deepEqual(bobs.map((r) => [r.user_id, r.kind]), [[bob, 'push']]);

    const updated = await t.asUser(alice, 'update public.week_plans set note = null where week_start = $1 returning 1', [week]);
    assert.equal(updated.length, 1);
    const deleted = await t.asUser(alice, 'delete from public.week_plans where week_start = $1 returning 1', [week]);
    assert.equal(deleted.length, 1);
    assert.deepEqual(await rowsOf(alice), []);
    assert.equal((await rowsOf(bob)).length, 1, "removing alice's week leaves bob's");
  });

  test('week_start must be a Monday and kind one of load / push / recovery / rest', async () => {
    const user = await t.createUser({ email: 'wp-checks@example.com' });
    for (const [offset, day] of [[1, 'martes'], [3, 'jueves'], [6, 'domingo']] as const) {
      await assert.rejects(
        t.asUser(user, `insert into public.week_plans (week_start, kind) values ($1::date + $2::int, 'load')`, [isoMonday(3), offset]),
        pgError({ code: '23514' }),
        `${day} is not a Monday`,
      );
    }
    const kinds = ['load', 'push', 'recovery', 'rest'];
    for (const [i, kind] of kinds.entries()) {
      await upsert(user, isoMonday(i + 3), kind);
    }
    assert.deepEqual((await rowsOf(user)).map((r) => r.kind), kinds);
    for (const kind of ['taper', 'Load', '']) {
      await assert.rejects(upsert(user, isoMonday(8), kind), pgError({ code: '23514' }), `kind ${kind}`);
    }
    await assert.rejects(
      t.asUser(user, 'insert into public.week_plans (week_start) values ($1)', [isoMonday(8)]),
      pgError({ code: '23502' }),
      'kind is required',
    );
  });

  test('target minutes 0–3000 or null, note up to 300 characters, source manual / ai_coach / claude', async () => {
    const user = await t.createUser({ email: 'wp-bounds@example.com' });
    for (const minutes of [-1, 3001]) {
      await assert.rejects(upsert(user, isoMonday(1), 'load', { minutes }), pgError({ code: '23514' }), `${minutes} min`);
    }
    assert.equal((await upsert(user, isoMonday(1), 'rest', { minutes: 0 })).target_minutes, 0);
    assert.equal((await upsert(user, isoMonday(2), 'push', { minutes: 3000 })).target_minutes, 3000);
    assert.equal((await upsert(user, isoMonday(3), 'load')).target_minutes, null, 'null = weekly hours × phase factor');

    await assert.rejects(upsert(user, isoMonday(4), 'load', { note: 'x'.repeat(301) }), pgError({ code: '23514' }));
    const note = 'ñ'.repeat(300);
    assert.equal((await upsert(user, isoMonday(4), 'load', { note })).note, note, '300 characters, not bytes');

    await assert.rejects(upsert(user, isoMonday(5), 'load', { source: 'garmin' }), pgError({ code: '23514' }));
    assert.equal((await upsert(user, isoMonday(5), 'load', { source: 'ai_coach' })).source, 'ai_coach');
    assert.equal((await upsert(user, isoMonday(6), 'load', { source: 'claude' })).source, 'claude');
    const [defaults] = await t.asUser<WeekPlanRow>(
      user,
      `insert into public.week_plans (week_start, kind) values ($1, 'load') returning ${COLUMNS}`,
      [isoMonday(7)],
    );
    assert.deepEqual(defaults, { user_id: user, week_start: isoMonday(7), kind: 'load', target_minutes: null, note: null, source: 'manual' });
  });

  test('saving the same week again replaces the entry and bumps updated_at only', async () => {
    const user = await t.createUser({ email: 'wp-upsert@example.com' });
    const week = isoMonday(2);
    await upsert(user, week, 'load', { minutes: 480 });
    await t.admin('alter table public.week_plans disable trigger week_plans_set_updated_at');
    await t.admin(
      `update public.week_plans set created_at = now() - interval '2 days', updated_at = now() - interval '2 days' where user_id = $1`,
      [user],
    );
    await t.admin('alter table public.week_plans enable trigger week_plans_set_updated_at');

    const saved = await upsert(user, week, 'recovery', { minutes: 300, note: 'Descarga antes del viaje', source: 'ai_coach' });
    assert.deepEqual(saved, {
      user_id: user,
      week_start: week,
      kind: 'recovery',
      target_minutes: 300,
      note: 'Descarga antes del viaje',
      source: 'ai_coach',
    });
    const [stamps] = await t.admin<{ n: number; created_kept: boolean; updated_now: boolean }>(
      `select count(*)::int as n,
         bool_and(created_at < now() - interval '1 day') as created_kept,
         bool_and(updated_at > now() - interval '1 minute') as updated_now
       from public.week_plans where user_id = $1`,
      [user],
    );
    assert.deepEqual(stamps, { n: 1, created_kept: true, updated_now: true });
  });

  test('the service role writes weeks for any athlete (coach, Claude) but never moves them to another one', async () => {
    const user = await t.createUser({ email: 'wp-service@example.com' });
    const other = await t.createUser({ email: 'wp-service-other@example.com' });
    await t.asService(
      `insert into public.week_plans (user_id, week_start, kind, target_minutes, note, source)
       values ($1, $2, 'push', 540, 'Más volumen en bici', 'claude')`,
      [user, isoMonday(1)],
    );
    const seen = await t.asUser<WeekPlanRow>(user, `select ${COLUMNS} from public.week_plans`);
    assert.deepEqual(seen.map((r) => [r.kind, r.target_minutes, r.source]), [['push', 540, 'claude']]);
    await assert.rejects(
      t.asService('update public.week_plans set user_id = $2 where user_id = $1', [user, other]),
      pgError({ hint: 'forbidden' }),
    );
    await assert.rejects(
      t.asService(`insert into public.week_plans (week_start, kind) values ($1, 'load')`, [isoMonday(1)]),
      pgError({ code: '23502' }),
      'the service role must name the athlete',
    );

    const privileges = await t.admin<{ privilege: string; authenticated: boolean; anon: boolean; service: boolean }>(
      `select p as privilege,
         has_table_privilege('authenticated', 'public.week_plans', p) as authenticated,
         has_table_privilege('anon', 'public.week_plans', p) as anon,
         has_table_privilege('service_role', 'public.week_plans', p) as service
       from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p`,
    );
    const crud = ['select', 'insert', 'update', 'delete'];
    for (const row of privileges) {
      assert.equal(row.authenticated, crud.includes(row.privilege), `authenticated ${row.privilege}`);
      assert.equal(row.anon, false, `anon ${row.privilege}`);
      assert.equal(row.service, true, `service_role ${row.privilege}`);
    }
  });

  test('weeks disappear with the profile and with the account', async () => {
    const byProfile = await t.createUser({ email: 'wp-profile@example.com' });
    const byAccount = await t.createUser({ email: 'wp-account@example.com' });
    for (const user of [byProfile, byAccount]) {
      await upsert(user, isoMonday(1), 'rest', { minutes: 0, note: 'Vacaciones' });
      await upsert(user, isoMonday(2), 'load');
    }
    await t.admin('delete from public.profiles where id = $1', [byProfile]);
    await t.admin('delete from auth.users where id = $1', [byAccount]);
    assert.deepEqual(await rowsOf(byProfile), []);
    assert.deepEqual(await rowsOf(byAccount), []);
  });
});
