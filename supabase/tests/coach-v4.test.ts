/**
 * v4 migration (20261109000100_coach_v4.sql): profiles.watch_brand, daily_metrics 'coros', the
 * privileges of the functions it creates or replaces, the week_plans realtime file, and applying it
 * on top of v3 data and again on live data. Coaching through apply_plan_changes is covered in
 * plan-changes.test.ts and the week_plans rows in week-plans.test.ts.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, isoMonday, migrationFiles, pgError, readSupabaseFile } from './harness.ts';
import type { TestDb } from './harness.ts';

const V4 = '20261109000100_coach_v4.sql';
const V4_PLATFORM = '20261109000900_week_plans_platform.sql';

const V4_FUNCTIONS = [
  'private.json_text_between(jsonb, integer, integer)',
  'private.normalize_workout_coaching(jsonb)',
  'private.validate_workout_coaching(jsonb)',
  'private.validate_workout_fields(jsonb, boolean)',
  'private.plan_add(uuid, jsonb)',
  'private.plan_update(uuid, uuid, jsonb)',
];

const COACHING = {
  objective: 'Rodar suave para asimilar la carga',
  keys: ['FC por debajo de 145 ppm', 'Cadencia alta'],
  success: 'Terminas con ganas de más',
  planB: null,
};

interface ApplyJson {
  applied: number;
  failed: { index: number; error: string }[];
}

async function applyChanges(t: TestDb, user: string, changes: unknown): Promise<ApplyJson> {
  const [row] = await t.asUser<{ r: ApplyJson }>(user, 'select public.apply_plan_changes($1::jsonb) as r', [JSON.stringify(changes)]);
  assert.ok(row);
  return row.r;
}

const addRun = (title: string, coaching?: unknown) => ({
  op: 'add',
  workout: { date: isoDay(2), sport: 'run', title, durationMin: 45, intensity: 'endurance', coaching },
  reason: 'r',
});

describe('coach v4: watch brand and COROS metrics', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('profiles.watch_brand: null until chosen; the owner picks garmin or coros or clears it; nothing else fits', async () => {
    const user = await t.createUser({ email: 'v4-watch@example.com' });
    const other = await t.createUser({ email: 'v4-watch-other@example.com' });
    const brandOf = async (id: string): Promise<string | null | undefined> =>
      (await t.admin<{ watch_brand: string | null }>('select watch_brand from public.profiles where id = $1', [id]))[0]?.watch_brand;

    assert.equal(await brandOf(user), null, 'not chosen yet = Garmin in the app');
    for (const brand of ['coros', 'garmin', null]) {
      await t.asUser(user, 'update public.profiles set watch_brand = $2 where id = $1', [user, brand]);
      assert.equal(await brandOf(user), brand);
    }
    await t.asUser(user, `update public.profiles set watch_brand = 'coros' where id = $1`, [user]);
    const [own] = await t.asUser<{ watch_brand: string | null }>(user, 'select watch_brand from public.profiles');
    assert.equal(own?.watch_brand, 'coros', 'the owner reads it back');

    for (const brand of ['polar', 'COROS', '']) {
      await assert.rejects(
        t.asUser(user, 'update public.profiles set watch_brand = $2 where id = $1', [user, brand]),
        pgError({ code: '23514' }),
        `watch_brand ${brand}`,
      );
    }
    const changed = await t.asUser(other, `update public.profiles set watch_brand = 'garmin' where id = $1 returning 1`, [user]);
    assert.equal(changed.length, 0, 'nobody else changes it');
    assert.equal(await brandOf(user), 'coros');

    const [grants] = await t.admin<{ update: boolean; anon_select: boolean; anon_update: boolean }>(
      `select has_column_privilege('authenticated', 'public.profiles', 'watch_brand', 'update') as update,
              has_column_privilege('anon', 'public.profiles', 'watch_brand', 'select') as anon_select,
              has_column_privilege('anon', 'public.profiles', 'watch_brand', 'update') as anon_update`,
    );
    assert.deepEqual(grants, { update: true, anon_select: false, anon_update: false });
  });

  test("daily_metrics: 'coros' rows sit next to Garmin and Apple Salud ones for the same day", async () => {
    const user = await t.createUser({ email: 'v4-coros@example.com' });
    const day = isoDay(-1);
    const sources: [string, number | null][] = [['garmin', 61], ['coros', 58], ['healthkit', null]];
    for (const [source, hrv] of sources) {
      await t.asUser(user, 'insert into public.daily_metrics (date, source, hrv_ms, resting_hr) values ($1, $2, $3, 48)', [day, source, hrv]);
    }
    // Claude's log_daily_metrics (service role) upserts the COROS row of the day.
    await t.asService(
      `insert into public.daily_metrics (user_id, date, source, hrv_ms, sleep_hours) values ($1, $2, 'coros', 60, 7.5)
       on conflict (user_id, date, source) do update set hrv_ms = excluded.hrv_ms, sleep_hours = excluded.sleep_hours`,
      [user, day],
    );
    const rows = await t.asUser<{ source: string; hrv: number | null; sleep: number | null }>(
      user,
      'select source, hrv_ms::float8 as hrv, sleep_hours::float8 as sleep from public.daily_metrics order by source',
    );
    assert.deepEqual(
      rows.map((r) => [r.source, r.hrv, r.sleep]),
      [['coros', 60, 7.5], ['garmin', 61, null], ['healthkit', null, null]],
    );
    for (const source of ['polar', 'COROS', 'strava']) {
      await assert.rejects(
        t.asUser(user, 'insert into public.daily_metrics (date, source) values ($1, $2)', [isoDay(-2), source]),
        pgError({ code: '23514' }),
        source,
      );
    }
  });
});

describe('coach v4: privileges and realtime', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('functions created or replaced by the migration run for service_role only', async () => {
    const rows = await t.admin<{ fn: string; anon: boolean; authenticated: boolean; public: boolean; service: boolean }>(
      `select f as fn,
         has_function_privilege('anon', f, 'execute') as anon,
         has_function_privilege('authenticated', f, 'execute') as authenticated,
         exists (
           select 1 from pg_proc p, aclexplode(p.proacl) a
           where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
         ) as public,
         has_function_privilege('service_role', f, 'execute') as service
       from unnest($1::text[]) as f`,
      [V4_FUNCTIONS],
    );
    assert.equal(rows.length, V4_FUNCTIONS.length);
    for (const row of rows) {
      assert.deepEqual(row, { fn: row.fn, anon: false, authenticated: false, public: false, service: true }, row.fn);
    }
    await assert.rejects(
      t.asUser(await t.createUser({ email: 'v4-direct@example.com' }), `select private.validate_workout_coaching('{}'::jsonb)`),
      pgError({ code: '42501' }),
    );
  });

  test('coaching and step errors are validation errors (SQLSTATE 22023, hint validation)', async () => {
    const draft = (extra: Record<string, unknown>) =>
      JSON.stringify({ date: isoDay(1), sport: 'run', title: 'Rodaje', durationMin: 40, intensity: 'endurance', ...extra });
    await assert.rejects(
      t.admin('select private.check_workout_draft($1::jsonb, false)', [draft({ coaching: { ...COACHING, success: ' ' } })]),
      pgError({ code: '22023', hint: 'validation', message: 'Criterio de éxito no válido (1–200 caracteres)' }),
    );
    await assert.rejects(
      t.admin('select private.check_workout_draft($1::jsonb, true)', [JSON.stringify({ steps: Array.from({ length: 51 }, () => ({ kind: 'work' })) })]),
      pgError({ code: '22023', hint: 'validation', message: 'Demasiados pasos (máximo 50)' }),
    );
    const [ok] = await t.admin<{ error: string | null }>('select private.validate_workout_fields($1::jsonb, false) as error', [
      draft({ coaching: COACHING, steps: [{ kind: 'work', durationMin: 20, target: { hr: { min: 140, max: 150 } }, cue: 'Suave' }] }),
    ]);
    assert.equal(ok?.error, null);
  });

  test('the realtime file is a no-op without supabase_realtime and adds week_plans once when it exists', async () => {
    const sql = readSupabaseFile(`migrations/${V4_PLATFORM}`);
    await t.db.exec(sql);
    await t.admin('create publication supabase_realtime');
    await t.db.exec(sql);
    await t.db.exec(sql);
    const rows = await t.admin<{ tablename: string }>(
      `select tablename from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime'`,
    );
    assert.deepEqual(rows.map((r) => r.tablename), ['week_plans']);
  });
});

describe('coach v4: upgrade from v3 and re-run', () => {
  let t: TestDb;
  let athlete: string;
  let v3Workout: string;

  before(async () => {
    t = await createTestDb({ migrate: false });
    for (const name of migrationFiles().filter((n) => n < V4)) {
      await t.db.exec(readSupabaseFile(`migrations/${name}`));
    }
    athlete = await t.createUser({ email: 'v4-upgrade@example.com' });
    // Before v4 the coaching key of a draft is ignored.
    assert.deepEqual(await applyChanges(t, athlete, [addRun('Rodaje v3', COACHING)]), { applied: 1, failed: [] });
    const [row] = await t.admin<{ id: string }>(`select id from public.workouts where title = 'Rodaje v3'`);
    assert.ok(row?.id);
    v3Workout = row.id;
    await t.admin(`insert into public.daily_metrics (user_id, date, source, hrv_ms) values ($1, $2, 'garmin', 55)`, [athlete, isoDay(-1)]);
    for (const name of migrationFiles().filter((n) => n >= V4)) {
      await t.db.exec(readSupabaseFile(`migrations/${name}`));
    }
  });

  after(async () => {
    await t.close();
  });

  test('v3 rows survive: no coaching, no watch brand, metrics untouched; v4 writes work right away', async () => {
    const [workout] = await t.admin<{ coaching: unknown; title: string }>('select title, coaching from public.workouts where id = $1', [v3Workout]);
    assert.deepEqual(workout, { title: 'Rodaje v3', coaching: null });
    const [profile] = await t.admin<{ watch_brand: string | null }>('select watch_brand from public.profiles where id = $1', [athlete]);
    assert.equal(profile?.watch_brand, null);
    const metrics = await t.asUser<{ source: string }>(athlete, 'select source from public.daily_metrics');
    assert.deepEqual(metrics.map((m) => m.source), ['garmin']);

    assert.deepEqual(
      await applyChanges(t, athlete, [{ op: 'update', workoutId: v3Workout, patch: { coaching: COACHING }, reason: 'r' }]),
      { applied: 1, failed: [] },
    );
    const [updated] = await t.admin<{ coaching: unknown }>('select coaching from public.workouts where id = $1', [v3Workout]);
    assert.deepEqual(updated?.coaching, COACHING);
  });

  test('running the migration again keeps data, policies, triggers and checks (nothing duplicated)', async () => {
    await t.asUser(athlete, `update public.profiles set watch_brand = 'coros' where id = $1`, [athlete]);
    await t.asUser(athlete, `insert into public.week_plans (week_start, kind, note) values ($1, 'recovery', 'Descarga')`, [isoMonday(1)]);
    await t.asUser(athlete, `insert into public.daily_metrics (date, source, hrv_ms) values ($1, 'coros', 57)`, [isoDay(-1)]);

    await t.db.exec(readSupabaseFile(`migrations/${V4}`));

    const [state] = await t.admin<{ brand: string; weeks: number; coros: number; coaching: unknown }>(
      `select (select watch_brand from public.profiles where id = $1) as brand,
              (select count(*)::int from public.week_plans where user_id = $1) as weeks,
              (select count(*)::int from public.daily_metrics where user_id = $1 and source = 'coros') as coros,
              (select coaching from public.workouts where id = $2) as coaching`,
      [athlete, v3Workout],
    );
    assert.deepEqual(state, { brand: 'coros', weeks: 1, coros: 1, coaching: COACHING });

    const policies = await t.admin<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'public' and tablename = 'week_plans' order by 1`,
    );
    assert.deepEqual(policies.map((p) => p.policyname), [
      'week_plans_delete_own',
      'week_plans_insert_own',
      'week_plans_select_own',
      'week_plans_update_own',
    ]);
    const triggers = await t.admin<{ tgname: string }>(
      `select tgname from pg_trigger where tgrelid = 'public.week_plans'::regclass and not tgisinternal order by 1`,
    );
    assert.deepEqual(triggers.map((r) => r.tgname), ['week_plans_keep_owner', 'week_plans_set_updated_at']);
    const checks = await t.admin<{ conname: string }>(
      `select conname from pg_constraint
       where conname in ('workouts_coaching_check', 'profiles_watch_brand_check', 'daily_metrics_source_check')
       order by 1`,
    );
    assert.deepEqual(checks.map((c) => c.conname), ['daily_metrics_source_check', 'profiles_watch_brand_check', 'workouts_coaching_check']);

    const result = await applyChanges(t, athlete, [addRun('Sin objetivo', { ...COACHING, objective: '' }), addRun('Con objetivo', COACHING)]);
    assert.deepEqual(result, { applied: 1, failed: [{ index: 0, error: 'Objetivo del entreno no válido (1–200 caracteres)' }] });
    await assert.rejects(
      t.asUser(athlete, `insert into public.week_plans (week_start, kind) values ($1::date + 1, 'load')`, [isoMonday(2)]),
      pgError({ code: '23514' }),
    );
  });
});
