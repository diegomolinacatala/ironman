import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, migrationFiles, pgError, platformMigrationFiles, readSupabaseFile } from './harness.ts';
import type { TestDb } from './harness.ts';

interface FunctionPrivilege {
  name: string;
  anon: boolean;
  authenticated: boolean;
  service: boolean;
}

const AUTHENTICATED_RPCS = [
  'apply_plan_changes',
  'is_username_available',
  'send_friend_request',
  'respond_friend_request',
  'list_friends',
  'search_profiles',
  'get_friend_week',
  'propose_joint_session',
  'respond_joint_session',
  'cancel_joint_session',
  'list_joint_sessions',
  'get_joint_session',
  'list_feed',
  'toggle_kudos',
  'register_push_token',
  'unregister_push_token',
  'mark_notifications_read',
  'create_personal_token',
  'list_personal_tokens',
  'revoke_personal_token',
  'integration_status',
  'delete_my_account',
];

const SERVICE_RPCS = [
  'svc_resolve_token',
  'svc_apply_plan_changes',
  'svc_get_friend_week',
  'svc_list_friends',
  'svc_reserve_coach_job',
  'svc_reserve_ai_call',
];

describe('schema, privileges and sign-up', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('migrations are applied in order and the platform migration is skipped', () => {
    const files = migrationFiles();
    assert.ok(files.length >= 8);
    assert.equal(files[0], '20261025000100_schema.sql');
    assert.ok(files.every((f) => !f.endsWith('_platform.sql')));
    assert.deepEqual([...files].sort(), files);
  });

  test('row level security is enabled on every public table', async () => {
    const rows = await t.admin<{ relname: string; rls: boolean }>(
      `select c.relname, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    assert.ok(rows.length >= 20, `expected ≥20 tables, got ${rows.length}`);
    const withoutRls = rows.filter((r) => !r.rls).map((r) => r.relname);
    assert.deepEqual(withoutRls, []);
  });

  test('anon has no privileges on any public table', async () => {
    const rows = await t.admin<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    assert.deepEqual(rows, []);
    await assert.rejects(t.asAnon('select * from public.profiles'), pgError({ code: '42501' }));
  });

  test('every security definer function pins search_path', async () => {
    const rows = await t.admin<{ name: string }>(
      `select n.nspname || '.' || p.proname as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    assert.deepEqual(rows, []);
  });

  test('RPC execute privileges: public API for authenticated, svc_* for service_role only', async () => {
    const rows = await t.admin<FunctionPrivilege>(
      `select p.proname as name,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const name of AUTHENTICATED_RPCS) {
      const row = byName.get(name);
      assert.ok(row, `missing RPC ${name}`);
      assert.equal(row.authenticated, true, `${name} must be executable by authenticated`);
      assert.equal(row.anon, false, `${name} must not be executable by anon`);
    }
    for (const name of SERVICE_RPCS) {
      const row = byName.get(name);
      assert.ok(row, `missing RPC ${name}`);
      assert.equal(row.authenticated, false, `${name} must not be executable by authenticated`);
      assert.equal(row.anon, false, `${name} must not be executable by anon`);
      assert.equal(row.service, true, `${name} must be executable by service_role`);
    }
    const unexpected = rows.filter(
      (r) => r.authenticated && !AUTHENTICATED_RPCS.includes(r.name),
    );
    assert.deepEqual(unexpected.map((r) => r.name), []);
  });

  test('private trigger/utility functions are not executable by API roles', async () => {
    const rows = await t.admin<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and (has_function_privilege('anon', p.oid, 'execute')
         or (has_function_privilege('authenticated', p.oid, 'execute')
             and p.proname not in ('are_friends', 'friend_ids', 'session_ids_for', 'is_session_participant')))`,
    );
    assert.deepEqual(rows, []);
  });

  test('sign-up creates a profile with a generated username and a display name', async () => {
    const fromEmail = await t.createUser({ email: 'laura.garcia_lopez@example.com' });
    const fromMeta = await t.createUser({ email: 'x@example.com', fullName: '  Álex Pérez ' });
    const rows = await t.admin<{ id: string; username: string; display_name: string; visibility: string; timezone: string }>(
      'select id, username, display_name, visibility, timezone from public.profiles where id = any($1::uuid[]) order by display_name',
      [[fromEmail, fromMeta]],
    );
    assert.equal(rows.length, 2);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get(fromEmail)?.display_name, 'Laura Garcia Lopez');
    assert.equal(byId.get(fromMeta)?.display_name, 'Álex Pérez');
    for (const row of rows) {
      assert.match(row.username, /^u[0-9a-f]{8}$/);
      assert.equal(row.visibility, 'full');
      assert.equal(row.timezone, 'Europe/Madrid');
    }
  });

  test('profiles: users read/update only their own row and cannot insert or delete', async () => {
    const a = await t.createUser({ email: 'p-a@example.com' });
    const b = await t.createUser({ email: 'p-b@example.com' });
    const visible = await t.asUser<{ id: string }>(a, 'select id from public.profiles');
    assert.deepEqual(visible.map((r) => r.id), [a]);

    const updated = await t.asUser(a, `update public.profiles set display_name = 'Hack' where id = $1 returning id`, [b]);
    assert.equal(updated.length, 0);
    await t.asUser(a, `update public.profiles set display_name = 'Ana', visibility = 'summary' where id = $1`, [a]);
    const [own] = await t.admin<{ display_name: string; visibility: string }>(
      'select display_name, visibility from public.profiles where id = $1',
      [a],
    );
    assert.equal(own?.display_name, 'Ana');
    assert.equal(own?.visibility, 'summary');

    await assert.rejects(
      t.asUser(a, `update public.profiles set id = $2 where id = $1`, [a, b]),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(a, `insert into public.profiles (id, username, display_name) values (gen_random_uuid(), 'nuevo', 'N')`),
      pgError({ code: '42501' }),
    );
    await assert.rejects(t.asUser(a, 'delete from public.profiles where id = $1', [a]), pgError({ code: '42501' }));
    await assert.rejects(
      t.asUser(a, `update public.profiles set timezone = 'Marte/Olympus' where id = $1`, [a]),
      pgError({ hint: 'validation', message: 'Zona horaria' }),
    );
  });

  test('is_username_available validates format and uniqueness (own name counts as free)', async () => {
    const a = await t.createUser({ email: 'un-a@example.com' });
    await t.admin(`update public.profiles set username = 'carla' where id = $1`, [a]);
    const b = await t.createUser({ email: 'un-b@example.com' });
    const check = async (user: string, name: string): Promise<boolean> => {
      const [row] = await t.asUser<{ ok: boolean }>(user, 'select public.is_username_available($1) as ok', [name]);
      return row?.ok === true;
    };
    assert.equal(await check(b, 'carla'), false);
    assert.equal(await check(b, '@Carla'), false);
    assert.equal(await check(a, 'carla'), true);
    assert.equal(await check(b, 'carla_2'), true);
    assert.equal(await check(b, 'no'), false);
    assert.equal(await check(b, 'con espacio'), false);
  });

  test('integration_credentials is invisible to authenticated users', async () => {
    const a = await t.createUser({ email: 'ic@example.com' });
    await t.admin(
      `insert into public.integration_credentials (user_id, provider, secret_ciphertext) values ($1, 'garmin_personal', 'cipher')`,
      [a],
    );
    await assert.rejects(
      t.asUser(a, 'select * from public.integration_credentials'),
      pgError({ code: '42501' }),
    );
    await assert.rejects(
      t.asUser(a, `update public.integration_credentials set state = 'error'`),
      pgError({ code: '42501' }),
    );
    const viaService = await t.asService('select user_id from public.integration_credentials where user_id = $1', [a]);
    assert.equal(viaService.length, 1);

    const status = await t.asUser<{ provider: string; state: string }>(a, 'select * from public.integration_status()');
    assert.deepEqual(status.map((s) => [s.provider, s.state]), [['garmin_personal', 'connected']]);
    assert.ok(!('secret_ciphertext' in (status[0] ?? {})));
  });

  test('anon cannot call RPCs', async () => {
    await assert.rejects(t.asAnon('select * from public.list_friends()'), pgError({ code: '42501' }));
    await assert.rejects(t.asAnon(`select public.apply_plan_changes('[]'::jsonb)`), pgError({ code: '42501' }));
  });

  test('authenticated RPCs reject callers without a JWT subject', async () => {
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select * from public.list_friends()');
      }),
      pgError({ hint: 'not_authenticated' }),
    );
  });
});

describe('seed.sql', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('applies cleanly and produces a usable demo dataset', async () => {
    await t.db.exec(readSupabaseFile('seed.sql'));
    const diego = '11111111-1111-4111-8111-111111111111';
    const alex = '22222222-2222-4222-8222-222222222222';
    const friends = await t.asUser<{ username: string; direction: string }>(diego, 'select * from public.list_friends()');
    assert.deepEqual(friends.map((f) => [f.username, f.direction]), [['alex', 'mutual']]);
    const invites = await t.asUser<{ type: string }>(diego, `select type from public.notifications where type = 'joint_invite'`);
    assert.equal(invites.length, 1);
    const sessions = await t.asUser<{ list: unknown[] }>(
      diego,
      `select public.list_joint_sessions(current_date - 7, current_date + 30) as list`,
    );
    assert.equal(sessions[0]?.list.length, 1);
    const workouts = await t.asUser<{ n: number }>(alex, 'select count(*)::int as n from public.workouts');
    assert.ok((workouts[0]?.n ?? 0) >= 5);
  });
});

describe('platform migration', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('is a safe no-op where realtime, pg_net, Vault and pg_cron are missing', async () => {
    const files = platformMigrationFiles();
    assert.ok(files.length >= 1);
    for (const file of files) {
      await t.db.exec(readSupabaseFile(`migrations/${file}`));
    }
    const [result] = await t.admin<{ r: string }>('select private.schedule_platform_jobs() as r');
    assert.match(result?.r ?? '', /pg_cron/);
    const user = await t.createUser({ email: 'platform@example.com' });
    await t.admin(
      `insert into public.notifications (user_id, type, title) values ($1, 'kudos', 'Prueba'), ($1, 'kudos', 'Prueba 2')`,
      [user],
    );
    const [invoke] = await t.admin<{ id: string | null }>(`select private.invoke_edge_function('push-dispatch') as id`);
    assert.equal(invoke?.id, null);
  });
});
