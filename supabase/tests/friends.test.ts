import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface FriendRow {
  friendship_id: string;
  status: string;
  direction: string;
  friend_id: string;
  username: string;
  display_name: string;
}

interface NotificationRow {
  type: string;
  title: string;
  body: string;
  data: { url?: string; friendshipId?: string };
}

describe('friendships flow', () => {
  let t: TestDb;
  let diego: string;
  let alex: string;
  let marta: string;

  const setUsername = (id: string, username: string, name: string) =>
    t.admin('update public.profiles set username = $2, display_name = $3 where id = $1', [id, username, name]);
  const friendsOf = (id: string) => t.asUser<FriendRow>(id, 'select * from public.list_friends()');
  const notificationsOf = (id: string, type: string) =>
    t.asUser<NotificationRow>(id, 'select type, title, body, data from public.notifications where type = $1 order by created_at', [type]);

  before(async () => {
    t = await createTestDb();
    diego = await t.createUser({ email: 'diego@example.com' });
    alex = await t.createUser({ email: 'alex@example.com' });
    marta = await t.createUser({ email: 'marta@example.com' });
    await setUsername(diego, 'diego', 'Diego');
    await setUsername(alex, 'alex', 'Álex');
    await setUsername(marta, 'marta', 'Marta Ruiz');
  });

  after(async () => {
    await t.close();
  });

  test('send → pending (outgoing/incoming) + notification to the addressee', async () => {
    const [sent] = await t.asUser<{ id: string }>(diego, `select public.send_friend_request('@Alex') as id`);
    assert.ok(sent?.id);

    const mine = await friendsOf(diego);
    assert.deepEqual(mine.map((f) => [f.username, f.status, f.direction]), [['alex', 'pending', 'outgoing']]);
    const theirs = await friendsOf(alex);
    assert.deepEqual(theirs.map((f) => [f.username, f.status, f.direction]), [['diego', 'pending', 'incoming']]);

    const [note] = await notificationsOf(alex, 'friend_request');
    assert.equal(note?.title, 'Nueva solicitud de amistad');
    assert.equal(note?.body, 'Diego (@diego) quiere entrenar contigo.');
    assert.equal(note?.data.url, '/together', 'opens Juntos, where the request card lives');
    assert.equal(note?.data.friendshipId, sent.id);

    // Sending again is idempotent.
    const [again] = await t.asUser<{ id: string }>(diego, `select public.send_friend_request('alex') as id`);
    assert.equal(again?.id, sent.id);
    assert.equal((await notificationsOf(alex, 'friend_request')).length, 1);
  });

  test('reverse request auto-accepts and notifies the original requester', async () => {
    const [res] = await t.asUser<{ id: string }>(alex, `select public.send_friend_request('diego') as id`);
    const [row] = await t.admin<{ status: string; requester_id: string }>(
      'select status, requester_id from public.friendships where id = $1',
      [res?.id],
    );
    assert.equal(row?.status, 'accepted');
    assert.equal(row?.requester_id, diego);
    assert.deepEqual((await friendsOf(diego)).map((f) => [f.username, f.direction]), [['alex', 'mutual']]);

    const [note] = await notificationsOf(diego, 'friend_accepted');
    assert.equal(note?.title, 'Álex ha aceptado tu solicitud');
    assert.equal(note?.data.url, `/friends/${alex}`);
  });

  test('errors: unknown user, self, already friends, not authenticated', async () => {
    await assert.rejects(
      t.asUser(diego, `select public.send_friend_request('nadie')`),
      pgError({ hint: 'not_found', message: '@nadie' }),
    );
    await assert.rejects(
      t.asUser(diego, `select public.send_friend_request('diego')`),
      pgError({ hint: 'validation' }),
    );
    await assert.rejects(
      t.asUser(diego, `select public.send_friend_request('alex')`),
      pgError({ hint: 'conflict', message: 'Ya sois amigos' }),
    );
    await assert.rejects(t.asUser(diego, `select public.send_friend_request('  ')`), pgError({ hint: 'validation' }));
  });

  test('respond: only the addressee, only while pending; decline hides the request', async () => {
    const [req] = await t.asUser<{ id: string }>(marta, `select public.send_friend_request('diego') as id`);
    await assert.rejects(
      t.asUser(marta, 'select public.respond_friend_request($1, true)', [req?.id]),
      pgError({ hint: 'not_found' }),
      'requester cannot accept their own request',
    );
    await assert.rejects(
      t.asUser(alex, 'select public.respond_friend_request($1, true)', [req?.id]),
      pgError({ hint: 'not_found' }),
      'third parties cannot respond',
    );
    await t.asUser(diego, 'select public.respond_friend_request($1, false)', [req?.id]);
    await assert.rejects(
      t.asUser(diego, 'select public.respond_friend_request($1, true)', [req?.id]),
      pgError({ hint: 'conflict' }),
    );
    assert.deepEqual((await friendsOf(marta)).map((f) => f.username), []);
    assert.deepEqual((await friendsOf(diego)).map((f) => f.username), ['alex']);

    // After a decline a new request starts over (and notifies again).
    const before = (await notificationsOf(diego, 'friend_request')).length;
    const [again] = await t.asUser<{ id: string }>(marta, `select public.send_friend_request('diego') as id`);
    assert.equal(again?.id, req?.id);
    assert.equal((await notificationsOf(diego, 'friend_request')).length, before + 1);
    await t.asUser(diego, 'select public.respond_friend_request($1, true)', [req?.id]);
    assert.deepEqual(
      (await friendsOf(diego)).map((f) => `${f.username}:${f.direction}`).sort(),
      ['alex:mutual', 'marta:mutual'],
    );
  });

  test('list_friends orders incoming requests first', async () => {
    const nuria = await t.createUser({ email: 'nuria@example.com' });
    await setUsername(nuria, 'nuria', 'Nuria');
    await t.asUser(nuria, `select public.send_friend_request('diego')`);
    const rows = await friendsOf(diego);
    assert.equal(rows[0]?.username, 'nuria');
    assert.equal(rows[0]?.direction, 'incoming');
  });

  test('unfriend by deleting the friendship row', async () => {
    const [row] = await friendsOf(marta);
    assert.equal(row?.username, 'diego');
    const deleted = await t.asUser(marta, 'delete from public.friendships where id = $1 returning 1', [row?.friendship_id]);
    assert.equal(deleted.length, 1);
    assert.deepEqual((await friendsOf(marta)).map((f) => f.username), []);
  });

  test('svc_list_friends is service-role only', async () => {
    await assert.rejects(t.asUser(diego, 'select * from public.svc_list_friends($1)', [diego]), pgError({ code: '42501' }));
    const rows = await t.asService<FriendRow>('select * from public.svc_list_friends($1)', [diego]);
    assert.ok(rows.some((r) => r.username === 'alex' && r.direction === 'mutual'));
  });
});

describe('search_profiles', () => {
  let t: TestDb;
  let me: string;

  before(async () => {
    t = await createTestDb();
    me = await t.createUser({ email: 'me@example.com' });
    await t.admin(`update public.profiles set username = 'mario', display_name = 'Mario' where id = $1`, [me]);
    const names: [string, string][] = [
      ['maria_tri', 'María López'],
      ['marina', 'Marina Gil'],
      ['pablo', 'Pablo Martín'],
      ['under_score', 'Test%Percent'],
    ];
    for (const [username, display] of names) {
      const id = await t.createUser({ email: `${username}@example.com` });
      await t.admin('update public.profiles set username = $2, display_name = $3 where id = $1', [id, username, display]);
    }
  });

  after(async () => {
    await t.close();
  });

  const search = async (q: string): Promise<string[]> =>
    (await t.asUser<{ username: string }>(me, 'select username from public.search_profiles($1)', [q])).map((r) => r.username);

  test('requires at least 2 characters', async () => {
    assert.deepEqual(await search('m'), []);
    assert.deepEqual(await search(' '), []);
  });

  test('matches username or display name, case-insensitive, excludes self', async () => {
    const result = await search('MAR');
    assert.ok(result.includes('maria_tri'));
    assert.ok(result.includes('marina'));
    assert.ok(result.includes('pablo'), 'display name "Pablo Martín" matches');
    assert.ok(!result.includes('mario'), 'self excluded');
    assert.deepEqual(result.slice(0, 2).sort(), ['maria_tri', 'marina'], 'username prefix matches rank first');
    assert.equal(result.at(-1), 'pablo');
  });

  test('wildcards are escaped', async () => {
    assert.deepEqual(await search('%%'), []);
    assert.deepEqual(await search('a_i'), [], '_ is literal (would match "ari" otherwise)');
    assert.deepEqual(await search('r_s'), ['under_score']);
    assert.deepEqual(await search('t%p'), ['under_score']);
  });

  test('limits to 20 results and only returns public fields', async () => {
    for (let i = 0; i < 25; i += 1) {
      const id = await t.createUser({ email: `bulk${i}@example.com` });
      await t.admin('update public.profiles set username = $2 where id = $1', [id, `zeta${i}`]);
    }
    const rows = await t.asUser<Record<string, unknown>>(me, `select * from public.search_profiles('zeta')`);
    assert.equal(rows.length, 20);
    assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), ['avatar_url', 'display_name', 'id', 'sports', 'username']);
  });
});
