import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createFriends, createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface CreatedToken {
  id: string;
  secret: string;
  prefix: string;
  scope: string;
  label: string;
}

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

describe('personal tokens', () => {
  let t: TestDb;
  let me: string;
  let other: string;

  const create = async (user: string, scope: string, label = 'Mi Claude'): Promise<CreatedToken> => {
    const [row] = await t.asUser<{ token: CreatedToken }>(user, 'select public.create_personal_token($1, $2) as token', [scope, label]);
    assert.ok(row);
    return row.token;
  };
  const resolve = async (hash: string, scope: string): Promise<string | null> => {
    const [row] = await t.asService<{ user_id: string | null }>('select public.svc_resolve_token($1, $2) as user_id', [hash, scope]);
    return row?.user_id ?? null;
  };

  before(async () => {
    t = await createTestDb();
    me = await t.createUser({ email: 'tokens@example.com' });
    other = await t.createUser({ email: 'tokens-other@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('secret format and stored SHA-256 hash match Node crypto', async () => {
    const token = await create(me, 'mcp');
    assert.match(token.secret, /^rb_[0-9a-f]{64}$/);
    assert.equal(token.prefix, token.secret.slice(0, 10));
    assert.equal(token.scope, 'mcp');
    assert.equal(token.label, 'Mi Claude');
    const [stored] = await t.admin<{ token_hash: string }>('select token_hash from public.personal_tokens where id = $1', [token.id]);
    assert.equal(stored?.token_hash, sha256Hex(token.secret));
  });

  test('token_hash is never readable by the client; list_personal_tokens omits it', async () => {
    await assert.rejects(t.asUser(me, 'select token_hash from public.personal_tokens'), pgError({ code: '42501' }));
    await assert.rejects(t.asUser(me, 'select * from public.personal_tokens'), pgError({ code: '42501' }));
    const visible = await t.asUser(me, 'select id, scope, prefix from public.personal_tokens');
    assert.ok(visible.length >= 1);
    const listed = await t.asUser<Record<string, unknown>>(me, 'select * from public.list_personal_tokens()');
    assert.ok(listed.length >= 1);
    assert.ok(listed.every((r) => !('token_hash' in r) && !('secret' in r)));
    assert.equal((await t.asUser(other, 'select * from public.list_personal_tokens()')).length, 0);
    await assert.rejects(
      t.asUser(me, `insert into public.personal_tokens (user_id, scope, token_hash, prefix) values ($1, 'mcp', 'x', 'x')`, [me]),
      pgError({ code: '42501' }),
    );
  });

  test('svc_resolve_token resolves the user, updates last_used_at, scope must match', async () => {
    const token = await create(me, 'ics', 'Calendario');
    assert.equal(await resolve(sha256Hex(token.secret), 'ics'), me);
    assert.equal(await resolve(sha256Hex(token.secret).toUpperCase(), 'ics'), me, 'hex case-insensitive');
    assert.equal(await resolve(sha256Hex(token.secret), 'mcp'), null, 'wrong scope');
    assert.equal(await resolve(sha256Hex('rb_inventado'), 'ics'), null);
    assert.equal(await resolve('not-a-hash', 'ics'), null);
    const [row] = await t.admin<{ used: boolean }>('select last_used_at is not null as used from public.personal_tokens where id = $1', [token.id]);
    assert.equal(row?.used, true);
  });

  test('svc_resolve_token is not executable by authenticated or anon', async () => {
    const token = await create(me, 'mcp');
    await assert.rejects(t.asUser(me, 'select public.svc_resolve_token($1, $2)', [sha256Hex(token.secret), 'mcp']), pgError({ code: '42501' }));
    await assert.rejects(t.asAnon('select public.svc_resolve_token($1, $2)', [sha256Hex(token.secret), 'mcp']), pgError({ code: '42501' }));
  });

  test('revoked tokens no longer resolve and cannot be re-activated', async () => {
    const token = await create(me, 'mcp', 'Para revocar');
    const hash = sha256Hex(token.secret);
    assert.equal(await resolve(hash, 'mcp'), me);
    await assert.rejects(t.asUser(other, 'select public.revoke_personal_token($1)', [token.id]), pgError({ hint: 'not_found' }));
    await t.asUser(me, 'select public.revoke_personal_token($1)', [token.id]);
    assert.equal(await resolve(hash, 'mcp'), null);
    await assert.rejects(
      t.asUser(me, 'update public.personal_tokens set revoked_at = null where id = $1', [token.id]),
      pgError({ code: '42501' }),
    );
    const [listed] = await t.asUser<{ revoked: boolean }>(me, 'select revoked_at is not null as revoked from public.list_personal_tokens() where id = $1', [token.id]);
    assert.equal(listed?.revoked, true);
  });

  test('clients can revoke directly through the table too', async () => {
    const token = await create(me, 'ics', 'Directo');
    await t.asUser(me, 'update public.personal_tokens set revoked_at = now() where id = $1', [token.id]);
    assert.equal(await resolve(sha256Hex(token.secret), 'ics'), null);
  });

  test('max 5 active tokens per scope; scope is validated', async () => {
    const user = await t.createUser({ email: 'max@example.com' });
    const tokens: CreatedToken[] = [];
    for (let i = 0; i < 5; i += 1) tokens.push(await create(user, 'mcp', `T${i}`));
    await assert.rejects(create(user, 'mcp'), pgError({ hint: 'conflict' }));
    await create(user, 'ics');
    await t.asUser(user, 'select public.revoke_personal_token($1)', [tokens[0]?.id]);
    await create(user, 'mcp');
    await assert.rejects(create(user, 'admin'), pgError({ hint: 'validation' }));
    const label = await create(user, 'ics', 'x'.repeat(100));
    assert.equal(label.label.length, 60);
  });
});

describe('delete_my_account', () => {
  let t: TestDb;

  before(async () => {
    t = await createTestDb();
  });

  after(async () => {
    await t.close();
  });

  test('removes the auth user and every owned row; friends keep their data', async () => {
    const { a: leaver, b: friend } = await createFriends(t, { email: 'leaver@example.com', fullName: 'Leaver' }, { email: 'stay@example.com', fullName: 'Stay' });
    await t.asUser(leaver, `insert into public.workouts (date, start_time, sport, title, duration_min, intensity) values ($1, '08:00', 'run', 'Mío', 40, 'endurance')`, [isoDay(2)]);
    await t.asUser(leaver, `insert into public.races (name, date, distance) values ('Carrera', $1, 'sprint')`, [isoDay(60)]);
    await t.asUser(leaver, `insert into public.life_events (kind, title, start_date, end_date) values ('injury', 'Rodilla', $1, $1)`, [isoDay(0)]);
    await t.asUser(leaver, `select public.create_personal_token('mcp', 'x')`);
    await t.asUser(leaver, `select public.register_push_token('ExponentPushToken[leaver]', 'ios')`);
    await t.asUser(friend, `insert into public.workouts (date, sport, title, duration_min, intensity) values ($1, 'swim', 'Del amigo', 40, 'endurance')`, [isoDay(2)]);
    const [session] = await t.asUser<{ id: string }>(
      leaver,
      'select public.propose_joint_session($1::jsonb, $2::uuid[]) as id',
      [JSON.stringify({ sport: 'run', date: isoDay(3), durationMin: 60, title: 'Juntos' }), [friend]],
    );
    await t.asUser(friend, 'select public.respond_joint_session($1, true)', [session?.id]);
    await t.admin(`insert into public.integration_credentials (user_id, provider, secret_ciphertext) values ($1, 'garmin_personal', 'c')`, [leaver]);

    await t.asUser(leaver, 'select public.delete_my_account()');

    const tables = [
      'workouts', 'races', 'life_events', 'personal_tokens', 'push_tokens', 'notifications',
      'activity_events', 'integration_credentials', 'friendships', 'joint_session_participants',
    ];
    for (const table of tables) {
      const column = table === 'activity_events' ? 'actor_id' : table === 'friendships' ? 'requester_id' : 'user_id';
      const rows = await t.admin(`select 1 from public.${table} where ${column} = $1`, [leaver]);
      assert.equal(rows.length, 0, `${table} rows remain`);
    }
    assert.equal((await t.admin('select 1 from auth.users where id = $1', [leaver])).length, 0);
    assert.equal((await t.admin('select 1 from public.profiles where id = $1', [leaver])).length, 0);
    assert.equal((await t.admin('select 1 from public.joint_sessions where id = $1', [session?.id])).length, 0);

    const friendWorkouts = await t.admin<{ title: string; joint_session_id: string | null }>(
      'select title, joint_session_id from public.workouts where user_id = $1 order by title',
      [friend],
    );
    assert.deepEqual(friendWorkouts.map((w) => w.title), ['Del amigo', 'Juntos'], 'friend keeps their workouts');
    assert.ok(friendWorkouts.every((w) => w.joint_session_id === null), 'links cleared');
    assert.deepEqual(await t.asUser(friend, 'select * from public.list_friends()'), []);
  });

  test('requires a signed-in caller', async () => {
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select public.delete_my_account()');
      }),
      pgError({ hint: 'not_authenticated' }),
    );
  });
});
