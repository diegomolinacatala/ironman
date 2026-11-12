import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createFriends, createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

describe('moderation: block and report users (App Store guideline 1.2)', () => {
  let t: TestDb;
  let diego: string;
  let david: string;
  let troll: string;

  const friendsOf = (user: string) =>
    t.asUser<{ friend_id: string; status: string }>(user, 'select friend_id, status from public.list_friends()');
  const block = (by: string, who: string) => t.asUser(by, 'select public.block_user($1)', [who]);
  const report = (by: string, who: string, reason = 'harassment', context = 'profile', details: string | null = null) =>
    t.asUser(by, 'select public.report_user($1, $2, $3, null, $4)', [who, reason, context, details]);

  before(async () => {
    t = await createTestDb();
    ({ a: diego, b: david } = await createFriends(t, { email: 'diego@example.com', fullName: 'Diego' }, { email: 'david@example.com', fullName: 'David' }));
    troll = await t.createUser({ email: 'troll@example.com', fullName: 'Troll' });
    await t.admin(`update public.profiles set username = 'diego' where id = $1`, [diego]);
    await t.admin(`update public.profiles set username = 'troll' where id = $1`, [troll]);
  });

  after(async () => {
    await t.close();
  });

  test('blocking a friend ends the friendship on both sides and hides the row', async () => {
    await block(diego, david);
    assert.deepEqual(await friendsOf(diego), []);
    assert.deepEqual(await friendsOf(david), []);
    const [areFriends] = await t.admin<{ ok: boolean }>('select private.are_friends($1, $2) as ok', [diego, david]);
    assert.equal(areFriends?.ok, false);
  });

  test('blocking a stranger who sent a request stops new requests from them', async () => {
    await t.asUser(troll, `select public.send_friend_request('diego')`);
    await block(diego, troll);
    await assert.rejects(t.asUser(troll, `select public.send_friend_request('diego')`), pgError({ hint: 'forbidden' }));
  });

  test('only the blocker can delete the blocked row (unblock)', async () => {
    await t.asUser(troll, 'delete from public.friendships where status = $1', ['blocked']);
    const [still] = await t.admin<{ n: number }>(
      `select count(*)::int as n from public.friendships where status = 'blocked' and requester_id = $1 and addressee_id = $2`,
      [diego, troll],
    );
    assert.equal(still?.n, 1);
    await t.asUser(diego, 'delete from public.friendships where addressee_id = $1', [troll]);
    const [gone] = await t.admin<{ n: number }>(`select count(*)::int as n from public.friendships where addressee_id = $1`, [troll]);
    assert.equal(gone?.n, 0);
  });

  test('the blocked person cannot take the block over to lift it', async () => {
    const victim = await t.createUser({ email: 'victim@example.com', fullName: 'Víctima' });
    const stalker = await t.createUser({ email: 'stalker@example.com', fullName: 'Acosador' });
    await t.admin(`update public.profiles set username = 'victim' where id = $1`, [victim]);
    await block(victim, stalker);
    await block(stalker, victim);
    await t.asUser(stalker, 'delete from public.friendships where requester_id = $1 or addressee_id = $1', [stalker]);
    const [row] = await t.admin<{ requester_id: string; status: string }>(
      'select requester_id, status from public.friendships where addressee_id = $1 or requester_id = $1',
      [stalker],
    );
    assert.deepEqual(row, { requester_id: victim, status: 'blocked' });
    await assert.rejects(t.asUser(stalker, `select public.send_friend_request('victim')`), pgError({ hint: 'forbidden' }));
    const found = await t.asUser<{ id: string }>(stalker, `select id from public.search_profiles('victim')`);
    assert.deepEqual(found, []);
  });

  test('a block hides messages and comment notifications in quedadas they already share', async () => {
    const ana = await t.createUser({ email: 'ana@example.com', fullName: 'Ana' });
    const bea = await t.createUser({ email: 'bea@example.com', fullName: 'Bea' });
    await t.admin(`insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [ana, bea]);
    const draft = JSON.stringify({ sport: 'run', date: '2099-01-10', durationMin: 45, intensity: 'endurance', title: 'Rodaje' });
    const [session] = await t.asUser<{ id: string }>(ana, 'select public.propose_joint_session($1::jsonb, $2::uuid[]) as id', [draft, [bea]]);
    assert.ok(session?.id);
    await t.asUser(bea, 'select public.add_joint_comment($1, $2)', [session.id, 'hola']);
    await block(ana, bea);
    await t.asUser(bea, 'select public.add_joint_comment($1, $2)', [session.id, 'sigo aquí']);
    const [list] = await t.asUser<{ comments: unknown[] }>(ana, 'select public.list_joint_comments($1) as comments', [session.id]);
    assert.deepEqual(list?.comments, []);
    const notes = await t.asUser<{ body: string }>(ana, `select body from public.notifications where type = 'joint_comment' order by created_at`);
    assert.deepEqual(notes.map((n) => n.body), ['hola']);
  });

  test('cannot block or report yourself', async () => {
    await assert.rejects(block(diego, diego), pgError({ hint: 'validation' }));
    await assert.rejects(report(diego, diego), pgError({ hint: 'validation' }));
  });

  test('a report is stored for the owner and is not readable by users', async () => {
    await report(diego, troll, 'spam', 'request', '  mensajes raros  ');
    const rows = await t.admin<{ reason: string; context: string; details: string }>(
      'select reason, context, details from public.user_reports where reporter_id = $1',
      [diego],
    );
    assert.deepEqual(rows, [{ reason: 'spam', context: 'request', details: 'mensajes raros' }]);
    await assert.rejects(t.asUser(diego, 'select * from public.user_reports'), pgError({ code: '42501' }));
  });

  test('rejects unknown reasons and floods', async () => {
    await assert.rejects(report(david, troll, 'boring'), pgError({ hint: 'validation' }));
    for (let i = 0; i < 20; i += 1) await report(david, troll);
    await assert.rejects(report(david, troll), pgError({ hint: 'rate_limited' }));
  });

  test('anon cannot call the moderation RPCs', async () => {
    await assert.rejects(t.asAnon('select public.block_user($1)', [troll]), pgError({ code: '42501' }));
  });
});
