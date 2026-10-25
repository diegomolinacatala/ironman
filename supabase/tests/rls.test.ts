import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

/** Own-rows tables: insert statement (as the owner, user_id omitted → default auth.uid()) + an updatable column. */
interface OwnTable {
  table: string;
  insert: string;
  update: string;
  key: string;
}

const day = isoDay(3);

const OWN_TABLES: readonly OwnTable[] = [
  {
    table: 'workouts',
    insert: `insert into public.workouts (date, sport, title, duration_min, intensity) values ('${day}', 'run', 'Rodaje', 45, 'endurance') returning id::text as key`,
    update: `title = 'Cambiado'`,
    key: 'id',
  },
  {
    table: 'races',
    insert: `insert into public.races (name, date, distance) values ('Carrera', '${isoDay(90)}', 'olympic') returning id::text as key`,
    update: `name = 'Cambiada'`,
    key: 'id',
  },
  {
    table: 'life_events',
    insert: `insert into public.life_events (kind, title, start_date, end_date) values ('padel', 'Pádel', '${day}', '${day}') returning id::text as key`,
    update: `title = 'Cambiado'`,
    key: 'id',
  },
  {
    table: 'busy_blocks',
    insert: `insert into public.busy_blocks (starts_at, ends_at, title) values ('${day} 09:00+00', '${day} 11:00+00', 'Clase') returning id::text as key`,
    update: `title = 'Cambiada'`,
    key: 'id',
  },
  {
    table: 'daily_checkins',
    insert: `insert into public.daily_checkins (date, sleep_quality, fatigue, soreness, stress, motivation) values ('${day}', 4, 2, 2, 2, 4) returning date::text as key`,
    update: `notes = 'Cambiado'`,
    key: 'date',
  },
  {
    table: 'daily_metrics',
    insert: `insert into public.daily_metrics (date, source, hrv_ms) values ('${day}', 'healthkit', 60) returning date::text as key`,
    update: `hrv_ms = 1`,
    key: 'date',
  },
  {
    table: 'nutrition_logs',
    insert: `insert into public.nutrition_logs (date, meal, description) values ('${day}', 'lunch', 'Pasta') returning id::text as key`,
    update: `description = 'Cambiada'`,
    key: 'id',
  },
  {
    table: 'plan_proposals',
    insert: `insert into public.plan_proposals (kind, source, week_start) values ('generate_week', 'rules', '${day}') returning id::text as key`,
    update: `summary = 'Cambiada'`,
    key: 'id',
  },
];

describe('RLS isolation between users', () => {
  let t: TestDb;
  let alice: string;
  let bob: string;

  before(async () => {
    t = await createTestDb();
    alice = await t.createUser({ email: 'alice@example.com' });
    bob = await t.createUser({ email: 'bob@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('harness: auth.uid()/auth.jwt() follow the request claims and role is authenticated', async () => {
    const seen = await t.withUser(alice, async (tx) => {
      const ids = await tx.query<{ uid: string; role: string; jwt_role: string }>(
        `select auth.uid()::text as uid, current_user as role, auth.jwt() ->> 'role' as jwt_role`,
      );
      await tx.query(`insert into public.races (name, date, distance) values ('En transacción', $1, 'sprint')`, [day]);
      const races = await tx.query<{ n: number }>(`select count(*)::int as n from public.races where name = 'En transacción'`);
      return { ...ids.rows[0], races: races.rows[0]?.n };
    });
    assert.deepEqual(seen, { uid: alice, role: 'authenticated', jwt_role: 'authenticated', races: 1 });
    const [outside] = await t.admin<{ uid: string | null }>('select auth.uid()::text as uid');
    assert.equal(outside?.uid, null, 'claims are transaction-local');
  });

  for (const spec of OWN_TABLES) {
    test(`${spec.table}: owner CRUD works, others see/change nothing`, async () => {
      const [created] = await t.asUser<{ key: string }>(alice, spec.insert);
      assert.ok(created?.key, 'insert returned a key');
      const where = `${spec.key}::text = $1`;

      const own = await t.asUser(alice, `select * from public.${spec.table} where ${where}`, [created.key]);
      assert.equal(own.length, 1);
      assert.equal((own[0] as { user_id?: string }).user_id, alice, 'user_id defaults to auth.uid()');

      const seen = await t.asUser(bob, `select * from public.${spec.table}`);
      assert.equal(seen.length, 0, 'bob sees none of alice rows');
      const changed = await t.asUser(bob, `update public.${spec.table} set ${spec.update} where ${where} returning 1`, [created.key]);
      assert.equal(changed.length, 0, 'bob cannot update');
      const deleted = await t.asUser(bob, `delete from public.${spec.table} where ${where} returning 1`, [created.key]);
      assert.equal(deleted.length, 0, 'bob cannot delete');

      await assert.rejects(
        t.asUser(bob, spec.insert.replace(/insert into public\.(\w+) \(/, `insert into public.$1 (user_id, `).replace(/values \(/, `values ('${alice}', `)),
        pgError({ code: '42501' }),
        'bob cannot insert rows owned by alice',
      );
      await assert.rejects(
        t.asUser(alice, `update public.${spec.table} set user_id = $2 where ${where}`, [created.key, bob]),
        pgError({ code: '42501' }),
        'alice cannot hand a row over to bob',
      );

      const updated = await t.asUser(alice, `update public.${spec.table} set ${spec.update} where ${where} returning 1`, [created.key]);
      assert.equal(updated.length, 1);
      const removed = await t.asUser(alice, `delete from public.${spec.table} where ${where} returning 1`, [created.key]);
      assert.equal(removed.length, 1);
    });
  }

  test('friendships: parties only, no direct insert/update', async () => {
    const carol = await t.createUser({ email: 'carol@example.com' });
    await t.admin(`insert into public.friendships (requester_id, addressee_id) values ($1, $2)`, [alice, carol]);
    assert.equal((await t.asUser(alice, 'select * from public.friendships')).length, 1);
    assert.equal((await t.asUser(carol, 'select * from public.friendships')).length, 1);
    assert.equal((await t.asUser(bob, 'select * from public.friendships')).length, 0);
    await assert.rejects(
      t.asUser(bob, `insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [bob, alice]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(carol, `update public.friendships set status = 'accepted'`),
      pgError({ code: '42501' }),
    );
    assert.equal((await t.asUser(bob, 'delete from public.friendships returning 1')).length, 0);
    assert.equal((await t.asUser(carol, 'delete from public.friendships returning 1')).length, 1);
  });

  test('joint sessions and participants: no direct writes', async () => {
    await assert.rejects(
      t.asUser(alice, `insert into public.joint_sessions (organizer_id, sport, date, duration_min, title) values ($1, 'run', $2, 60, 'X')`, [alice, day]),
      pgError({ code: '42501' }),
    );
    assert.equal((await t.asUser(alice, 'select * from public.joint_sessions')).length, 0);
    assert.equal((await t.asUser(alice, 'select * from public.joint_session_participants')).length, 0);
  });

  test('workouts cannot be linked to a quedada the user is not part of', async () => {
    const [session] = await t.admin<{ id: string }>(
      `insert into public.joint_sessions (organizer_id, sport, date, duration_min, title) values ($1, 'run', $2, 60, 'Solo Bob') returning id`,
      [bob, day],
    );
    await assert.rejects(
      t.asUser(alice, `insert into public.workouts (date, sport, title, duration_min, intensity, joint_session_id) values ($1, 'run', 'Colado', 60, 'endurance', $2)`, [day, session?.id]),
      pgError({ hint: 'forbidden' }),
    );
    const [w] = await t.asUser<{ id: string }>(alice, `insert into public.workouts (date, sport, title, duration_min, intensity) values ($1, 'run', 'Mío', 60, 'endurance') returning id`, [day]);
    await assert.rejects(
      t.asUser(alice, `update public.workouts set joint_session_id = $2 where id = $1`, [w?.id, session?.id]),
      pgError({ hint: 'forbidden' }),
    );
  });

  test('notifications: own only, only read_at is updatable', async () => {
    await t.admin(`insert into public.notifications (user_id, type, title) values ($1, 'kudos', 'Hola')`, [alice]);
    assert.equal((await t.asUser(bob, 'select * from public.notifications')).length, 0);
    const mine = await t.asUser<{ id: string }>(alice, `select id from public.notifications where title = 'Hola'`);
    assert.equal(mine.length, 1);
    await t.asUser(alice, 'update public.notifications set read_at = now() where id = $1', [mine[0]?.id]);
    await assert.rejects(
      t.asUser(alice, `update public.notifications set title = 'Otro' where id = $1`, [mine[0]?.id]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(alice, `insert into public.notifications (user_id, type, title) values ($1, 'kudos', 'Spam')`, [bob]),
      pgError({ code: '42501' }),
    );
    assert.equal((await t.asUser(bob, 'delete from public.notifications returning 1')).length, 0);
    assert.equal((await t.asUser(alice, `delete from public.notifications where title = 'Hola' returning 1`)).length, 1);
  });

  test('push tokens: own only, writes through register_push_token', async () => {
    await t.asUser(alice, `select public.register_push_token('ExponentPushToken[abc]', 'ios')`);
    assert.equal((await t.asUser(alice, 'select * from public.push_tokens')).length, 1);
    assert.equal((await t.asUser(bob, 'select * from public.push_tokens')).length, 0);
    await assert.rejects(
      t.asUser(bob, `insert into public.push_tokens (token, user_id, platform) values ('t', $1, 'ios')`, [bob]),
      pgError({ code: '42501' }),
    );
    // Re-registering the same device token moves it to the new user.
    await t.asUser(bob, `select public.register_push_token('ExponentPushToken[abc]', 'ios')`);
    assert.equal((await t.asUser(alice, 'select * from public.push_tokens')).length, 0);
    assert.equal((await t.asUser(bob, 'select * from public.push_tokens')).length, 1);
    await assert.rejects(
      t.asUser(bob, `select public.register_push_token('x', 'symbian')`),
      pgError({ hint: 'validation' }),
    );
  });

  test('coach_jobs and ai_usage: read own, no client writes', async () => {
    await t.admin(`insert into public.coach_jobs (user_id, request) values ($1, '{}')`, [alice]);
    await t.admin(`insert into public.ai_usage (user_id, function_name) values ($1, 'coach')`, [alice]);
    assert.equal((await t.asUser(alice, 'select * from public.coach_jobs')).length, 1);
    assert.equal((await t.asUser(bob, 'select * from public.coach_jobs')).length, 0);
    assert.equal((await t.asUser(alice, 'select * from public.ai_usage')).length, 1);
    assert.equal((await t.asUser(bob, 'select * from public.ai_usage')).length, 0);
    await assert.rejects(
      t.asUser(alice, `insert into public.coach_jobs (user_id, request) values ($1, '{}')`, [alice]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(alice, `update public.coach_jobs set status = 'done'`),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(alice, `insert into public.ai_usage (user_id, function_name) values ($1, 'coach')`, [alice]),
      pgError({ code: '42501' }),
    );
    const viaService = await t.asService<{ id: string }>(
      `insert into public.ai_usage (user_id, function_name, input_tokens) values ($1, 'coach', 10) returning id::text`,
      [alice],
    );
    assert.equal(viaService.length, 1);
  });

  test('activity events and kudos have no direct client access (list_feed / toggle_kudos only)', async () => {
    const [event] = await t.admin<{ id: string }>(
      `insert into public.activity_events (actor_id, type) values ($1, 'race_added') returning id`,
      [alice],
    );
    await t.admin('insert into public.kudos (event_id, user_id) values ($1, $2)', [event?.id, alice]);
    for (const user of [alice, bob]) {
      await assert.rejects(t.asUser(user, 'select * from public.activity_events'), pgError({ code: '42501' }));
      await assert.rejects(t.asUser(user, 'select * from public.kudos'), pgError({ code: '42501' }));
      await assert.rejects(
        t.asUser(user, 'insert into public.kudos (event_id, user_id) values ($1, $2)', [event?.id, user]),
        pgError({ code: '42501' }),
      );
      await assert.rejects(t.asUser(user, 'delete from public.kudos'), pgError({ code: '42501' }));
    }
    await assert.rejects(
      t.asUser(alice, `insert into public.activity_events (actor_id, type) values ($1, 'race_added')`, [alice]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(alice, `update public.activity_events set payload = '{}' where id = $1`, [event?.id]),
      pgError({ code: '42501' }),
    );
    const policies = await t.admin<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'public' and tablename in ('activity_events', 'kudos')`,
    );
    assert.deepEqual(policies, [], 'no client policies left on the feed tables');
    const own = await t.asUser<{ kudos_count: number; has_kudoed: boolean }>(
      alice,
      'select kudos_count, has_kudoed from public.list_feed(100) where id = $1',
      [event?.id],
    );
    assert.deepEqual(own, [{ kudos_count: 1, has_kudoed: true }], 'the RPC still reads them');
  });
});
