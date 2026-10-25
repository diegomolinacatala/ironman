import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface FeedRow {
  id: string;
  actor_id: string;
  type: string;
  payload: Record<string, unknown>;
}

describe('feed privacy: masking cannot be bypassed', () => {
  let t: TestDb;
  let organizer: string;
  let hidden: string;
  let open: string;
  let onlyOrganizerFriend: string;
  let sharedFriend: string;

  const user = async (email: string, name: string, visibility = 'full') => {
    const id = await t.createUser({ email, fullName: name });
    await t.admin('update public.profiles set visibility = $2 where id = $1', [id, visibility]);
    return id;
  };
  const befriend = (a: string, b: string) =>
    t.admin(
      `insert into public.friendships (requester_id, addressee_id, status, responded_at) values ($1, $2, 'accepted', now())`,
      [a, b],
    );
  const setVisibility = (id: string, visibility: string) =>
    t.admin('update public.profiles set visibility = $2 where id = $1', [id, visibility]);
  const feedOf = (id: string) => t.asUser<FeedRow>(id, 'select id, actor_id, type, payload from public.list_feed(100)');
  const jointItem = async (viewer: string, sessionId: string) =>
    (await feedOf(viewer)).find((f) => f.type === 'joint_confirmed' && f.payload['jointSessionId'] === sessionId);

  before(async () => {
    t = await createTestDb();
    organizer = await user('org@example.com', 'Organizer A');
    hidden = await user('private@example.com', 'Private B', 'busy');
    open = await user('open@example.com', 'Open O');
    onlyOrganizerFriend = await user('c@example.com', 'Carla');
    sharedFriend = await user('d@example.com', 'Dani');
    await befriend(organizer, hidden);
    await befriend(organizer, open);
    await befriend(organizer, onlyOrganizerFriend);
    await befriend(organizer, sharedFriend);
    await befriend(sharedFriend, open);
    await befriend(sharedFriend, hidden);
  });

  after(async () => {
    await t.close();
  });

  test('a visibility downgrade hides old events: list_feed masks them and direct reads are denied', async () => {
    const [w] = await t.asUser<{ id: string }>(
      open,
      `insert into public.workouts (date, start_time, sport, title, duration_min, intensity)
       values ($1, '07:00', 'run', 'Rodaje con dolor de rodilla', 45, 'recovery') returning id`,
      [isoDay(-1)],
    );
    await t.asUser(open, `update public.workouts set status = 'completed' where id = $1`, [w?.id]);
    const visible = (await feedOf(sharedFriend)).find((f) => f.payload['workoutId'] === w?.id);
    assert.equal(visible?.payload['title'], 'Rodaje con dolor de rodilla');

    await setVisibility(open, 'busy');
    assert.ok(!(await feedOf(sharedFriend)).some((f) => f.actor_id === open), 'busy: nothing in the feed');
    await assert.rejects(
      t.asUser(sharedFriend, 'select payload from public.activity_events where actor_id = $1', [open]),
      pgError({ code: '42501' }),
      'the raw payload is not readable directly',
    );

    await setVisibility(open, 'summary');
    const summarized = (await feedOf(sharedFriend)).find((f) => f.payload['workoutId'] === w?.id);
    assert.ok(summarized);
    assert.ok(!('title' in summarized.payload), 'summary: title stripped at read time');
    await assert.rejects(
      t.asUser(sharedFriend, 'select payload from public.activity_events where actor_id = $1', [open]),
      pgError({ code: '42501' }),
    );
    await setVisibility(open, 'full');
  });

  test('kudos follow list_feed visibility: none on a busy friend', async () => {
    const [race] = await t.asUser<{ id: string }>(
      organizer,
      `insert into public.races (name, date, distance) values ('Popular', $1, 'sprint') returning id`,
      [isoDay(40)],
    );
    const event = (await feedOf(onlyOrganizerFriend)).find((f) => f.payload['raceId'] === race?.id);
    assert.ok(event);
    await setVisibility(organizer, 'busy');
    await assert.rejects(
      t.asUser(onlyOrganizerFriend, 'select public.toggle_kudos($1)', [event.id]),
      pgError({ hint: 'not_found' }),
    );
    const [own] = await t.asUser<{ k: boolean }>(organizer, 'select public.toggle_kudos($1) as k', [event.id]);
    assert.equal(own?.k, true, 'the actor can still kudo their own event');
    await setVisibility(organizer, 'full');
    const [friend] = await t.asUser<{ k: boolean }>(onlyOrganizerFriend, 'select public.toggle_kudos($1) as k', [event.id]);
    assert.equal(friend?.k, true);
  });

  test('joint_confirmed: participants are masked per viewer and never stored as names', async () => {
    const [session] = await t.asUser<{ id: string }>(
      organizer,
      'select public.propose_joint_session($1::jsonb, $2::uuid[]) as id',
      [
        JSON.stringify({ sport: 'run', date: isoDay(4), startTime: '19:00', durationMin: 60, intensity: 'threshold', title: 'Series' }),
        [hidden, open],
      ],
    );
    const id = session?.id ?? '';
    await t.asUser(hidden, 'select public.respond_joint_session($1, true)', [id]);
    await t.asUser(open, 'select public.respond_joint_session($1, true)', [id]);

    const [stored] = await t.admin<{ payload: Record<string, unknown> }>(
      `select payload from public.activity_events where type = 'joint_confirmed' and payload ->> 'jointSessionId' = $1`,
      [id],
    );
    assert.ok(stored);
    assert.ok(!('participants' in stored.payload), 'no names in storage');

    const stranger = await jointItem(onlyOrganizerFriend, id);
    assert.ok(stranger, 'friends of the organizer still see the quedada');
    assert.deepEqual(stranger.payload['participants'], ['Organizer A']);
    assert.equal(stranger.payload['othersCount'], 2);
    assert.ok(!JSON.stringify(stranger.payload).includes('Private B'), 'busy participant never named');
    assert.equal(stranger.payload['title'], 'Series');

    const mutual = await jointItem(sharedFriend, id);
    assert.deepEqual(mutual?.payload['participants'], ['Open O', 'Organizer A'], 'busy friends stay hidden too');
    assert.equal(mutual?.payload['othersCount'], 1);

    for (const insider of [organizer, hidden, open]) {
      const item = await jointItem(insider, id);
      assert.deepEqual(item?.payload['participants'], ['Open O', 'Organizer A', 'Private B'], 'participants see everyone');
      assert.equal(item?.payload['othersCount'], 0);
    }

    await setVisibility(organizer, 'summary');
    const summary = await jointItem(onlyOrganizerFriend, id);
    assert.ok(summary && !('title' in summary.payload), "organizer 'summary' hides the title");
    await setVisibility(organizer, 'full');
  });

  test('joint_confirmed: a deleted participant disappears from the list', async () => {
    const leaver = await user('leaver@example.com', 'Leaver L');
    await befriend(organizer, leaver);
    await befriend(onlyOrganizerFriend, leaver);
    const [session] = await t.asUser<{ id: string }>(
      organizer,
      'select public.propose_joint_session($1::jsonb, $2::uuid[]) as id',
      [JSON.stringify({ sport: 'bike', date: isoDay(6), durationMin: 90, title: 'Rodada' }), [leaver]],
    );
    await t.asUser(leaver, 'select public.respond_joint_session($1, true)', [session?.id]);
    const before = await jointItem(onlyOrganizerFriend, session?.id ?? '');
    assert.deepEqual(before?.payload['participants'], ['Leaver L', 'Organizer A']);

    await t.asUser(leaver, 'select public.delete_my_account()');
    const afterDelete = await jointItem(onlyOrganizerFriend, session?.id ?? '');
    assert.deepEqual(afterDelete?.payload['participants'], ['Organizer A']);
    assert.equal(afterDelete?.payload['othersCount'], 0);
  });
});
