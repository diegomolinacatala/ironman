import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createFriends, createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface FeedRow {
  id: string;
  actor_id: string;
  actor_username: string;
  actor_display_name: string;
  type: string;
  payload: Record<string, unknown>;
  kudos_count: number;
  has_kudoed: boolean;
}

describe('feed and kudos', () => {
  let t: TestDb;
  let diego: string;
  let alex: string;
  let stranger: string;

  const complete = async (user: string, title: string, extra: Record<string, unknown> = {}) => {
    const [w] = await t.asUser<{ id: string }>(
      user,
      `insert into public.workouts (date, start_time, sport, title, duration_min, distance_m, intensity)
       values ($1, '07:00', 'run', $2, 50, 10000, 'endurance') returning id`,
      [isoDay(-1), title],
    );
    await t.asUser(
      user,
      `update public.workouts set status = 'completed', completed = $2::jsonb where id = $1`,
      [w?.id, JSON.stringify({ durationMin: 52, distanceM: 10200, rpe: 6, ...extra })],
    );
    return w?.id ?? '';
  };
  const feedOf = (user: string) => t.asUser<FeedRow>(user, 'select * from public.list_feed(50)');
  const setVisibility = (user: string, visibility: string) =>
    t.admin('update public.profiles set visibility = $2 where id = $1', [user, visibility]);

  before(async () => {
    t = await createTestDb();
    ({ a: diego, b: alex } = await createFriends(t, { email: 'diego@example.com', fullName: 'Diego' }, { email: 'alex@example.com', fullName: 'Álex' }));
    stranger = await t.createUser({ email: 'stranger@example.com', fullName: 'Extraño' });
  });

  after(async () => {
    await t.close();
  });

  test('completing a workout posts workout_completed with completed duration/distance', async () => {
    const id = await complete(alex, 'Rodaje del río');
    const feed = await feedOf(diego);
    const item = feed.find((f) => f.payload['workoutId'] === id);
    assert.ok(item, 'friend sees the event');
    assert.equal(item.type, 'workout_completed');
    assert.equal(item.actor_display_name, 'Álex');
    assert.deepEqual(
      { sport: item.payload['sport'], title: item.payload['title'], durationMin: item.payload['durationMin'], distanceM: item.payload['distanceM'] },
      { sport: 'run', title: 'Rodaje del río', durationMin: 52, distanceM: 10200 },
    );
    assert.equal((await feedOf(stranger)).length, 0, 'non-friends see nothing');

    // Re-completing the same workout does not duplicate the event.
    await t.asUser(alex, `update public.workouts set status = 'planned', completed = null where id = $1`, [id]);
    await t.asUser(alex, `update public.workouts set status = 'completed' where id = $1`, [id]);
    assert.equal((await feedOf(alex)).filter((f) => f.payload['workoutId'] === id).length, 1);
  });

  test('imported completed workouts (insert) also post; malformed completed data does not break the write', async () => {
    const [w] = await t.asService<{ id: string }>(
      `insert into public.workouts (user_id, date, sport, title, duration_min, intensity, status, source, external_id, completed)
       values ($1, $2, 'bike', 'Garmin ride', 90, 'endurance', 'completed', 'garmin', 'garmin:1', '{"durationMin":"mucho"}') returning id`,
      [alex, isoDay(-2)],
    );
    const item = (await feedOf(diego)).find((f) => f.payload['workoutId'] === w?.id);
    assert.equal(item?.payload['durationMin'], 90, 'falls back to planned duration');
  });

  test('visibility: busy posts nothing, summary posts without title (and masks at read time)', async () => {
    await setVisibility(alex, 'busy');
    const hidden = await complete(alex, 'Secreto busy');
    assert.ok(!(await feedOf(diego)).some((f) => f.payload['workoutId'] === hidden));
    const [count] = await t.admin<{ n: number }>(
      `select count(*)::int as n from public.activity_events where payload ->> 'workoutId' = $1`,
      [hidden],
    );
    assert.equal(count?.n, 0);
    assert.ok(!(await feedOf(diego)).some((f) => f.actor_id === alex), 'old events hidden while busy');

    await setVisibility(alex, 'summary');
    const summarized = await complete(alex, 'Secreto summary');
    const items = await feedOf(diego);
    const item = items.find((f) => f.payload['workoutId'] === summarized);
    assert.ok(item);
    assert.ok(!('title' in item.payload));
    assert.ok(items.filter((f) => f.actor_id === alex).every((f) => !('title' in f.payload)), 'older titles masked too');
    const own = (await feedOf(alex)).find((f) => f.payload['workoutId'] === summarized);
    assert.ok(own, 'actor sees own event');
    await setVisibility(alex, 'full');
  });

  test('race_added events (removed with the race)', async () => {
    const [race] = await t.asUser<{ id: string }>(
      diego,
      `insert into public.races (name, date, distance, priority) values ('Media de Valencia', $1, 'half', 'A') returning id`,
      [isoDay(120)],
    );
    const item = (await feedOf(alex)).find((f) => f.type === 'race_added');
    assert.equal(item?.payload['name'], 'Media de Valencia');
    assert.equal(item?.payload['distance'], 'half');
    await t.asUser(diego, `insert into public.races (name, date, distance) values ('Borrable', $1, 'sprint')`, [isoDay(30)]);
    const [gone] = await t.asUser<{ id: string }>(diego, `delete from public.races where name = 'Borrable' returning id`);
    assert.ok(!(await feedOf(alex)).some((f) => f.payload['raceId'] === gone?.id));
    assert.ok((await feedOf(alex)).some((f) => f.payload['raceId'] === race?.id));
  });

  test('un-completing or deleting a completed workout removes its feed event', async () => {
    const reset = await complete(diego, 'Me equivoqué');
    await t.asUser(diego, `update public.workouts set status = 'planned', completed = null where id = $1`, [reset]);
    assert.ok(!(await feedOf(alex)).some((f) => f.payload['workoutId'] === reset));
    const removed = await complete(diego, 'Lo borro');
    assert.ok((await feedOf(alex)).some((f) => f.payload['workoutId'] === removed));
    await t.asUser(diego, 'delete from public.workouts where id = $1', [removed]);
    assert.ok(!(await feedOf(alex)).some((f) => f.payload['workoutId'] === removed));
  });

  test('toggle_kudos: visible events only, toggles, counts and notifies the actor once', async () => {
    const id = await complete(diego, 'Series en pista');
    const event = (await feedOf(alex)).find((f) => f.payload['workoutId'] === id);
    assert.ok(event);

    const [on] = await t.asUser<{ k: boolean }>(alex, 'select public.toggle_kudos($1) as k', [event.id]);
    assert.equal(on?.k, true);
    let view = (await feedOf(diego)).find((f) => f.id === event.id);
    assert.equal(view?.kudos_count, 1);
    assert.equal(view?.has_kudoed, false);
    assert.equal((await feedOf(alex)).find((f) => f.id === event.id)?.has_kudoed, true);

    const notifications = await t.asUser<{ title: string; body: string; data: { url: string; eventId: string } }>(
      diego,
      `select title, body, data from public.notifications where type = 'kudos'`,
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.title, 'Álex te ha dado kudos');
    assert.equal(notifications[0]?.body, 'Por «Series en pista»');
    assert.equal(notifications[0]?.data.eventId, event.id);

    const [off] = await t.asUser<{ k: boolean }>(alex, 'select public.toggle_kudos($1) as k', [event.id]);
    assert.equal(off?.k, false);
    view = (await feedOf(diego)).find((f) => f.id === event.id);
    assert.equal(view?.kudos_count, 0);
    await t.asUser(alex, 'select public.toggle_kudos($1)', [event.id]);
    const again = await t.asUser(diego, `select 1 from public.notifications where type = 'kudos'`);
    assert.equal(again.length, 1, 'kudos notifications are deduplicated');

    await assert.rejects(t.asUser(stranger, 'select public.toggle_kudos($1)', [event.id]), pgError({ hint: 'not_found' }));
    const [self] = await t.asUser<{ k: boolean }>(diego, 'select public.toggle_kudos($1) as k', [event.id]);
    assert.equal(self?.k, true, 'own events can be kudoed');
    const selfNotes = await t.asUser(diego, `select 1 from public.notifications where type = 'kudos'`);
    assert.equal(selfNotes.length, 1, 'no notification for own kudos');
  });

  test('list_feed respects the limit and orders newest first', async () => {
    const rows = await t.asUser<FeedRow & { created_at: Date }>(diego, 'select * from public.list_feed(2)');
    assert.equal(rows.length, 2);
    assert.ok((rows[0]?.created_at.getTime() ?? 0) >= (rows[1]?.created_at.getTime() ?? 0));
  });

  test('mark_notifications_read marks given ids or everything', async () => {
    await t.admin(
      `insert into public.notifications (user_id, type, title) values ($1, 'friend_completed', 'Uno'), ($1, 'friend_completed', 'Dos')`,
      [diego],
    );
    const unread = async () =>
      (await t.asUser<{ n: number }>(diego, 'select count(*)::int as n from public.notifications where read_at is null'))[0]?.n ?? 0;
    const [first] = await t.asUser<{ id: string }>(diego, 'select id from public.notifications order by created_at limit 1');
    const total = await unread();
    assert.ok(total >= 2);
    await t.asUser(diego, 'select public.mark_notifications_read($1::uuid[])', [[first?.id]]);
    assert.equal(await unread(), total - 1);
    await t.asUser(alex, 'select public.mark_notifications_read()');
    assert.equal(await unread(), total - 1, 'other users cannot mark mine');
    await t.asUser(diego, 'select public.mark_notifications_read()');
    assert.equal(await unread(), 0);
  });
});
