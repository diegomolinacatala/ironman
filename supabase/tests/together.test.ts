import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createFriends, createTestDb, isoDay, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface Participant {
  userId: string;
  displayName: string;
  status: string;
  workoutId: string | null;
}

interface SessionJson {
  id: string;
  date: string;
  startTime: string | null;
  title: string;
  location: string | null;
  status: string;
  isOpen: boolean;
  participants: Participant[];
}

const DAY = isoDay(4);

const draft = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    sport: 'run',
    date: DAY,
    startTime: '07:30',
    durationMin: 60,
    intensity: 'endurance',
    title: 'Rodaje en el Retiro',
    ...overrides,
  });

describe('Juntos v3: open quedadas, edits, comments, joint completion, friend races', () => {
  let t: TestDb;
  let diego: string;
  let david: string;
  let marta: string;
  let stranger: string;

  const propose = async (by: string, invitees: string[], overrides: Record<string, unknown> = {}) => {
    const [row] = await t.asUser<{ id: string }>(by, 'select public.propose_joint_session($1::jsonb, $2::uuid[]) as id', [
      draft(overrides),
      invitees,
    ]);
    assert.ok(row?.id);
    return row.id;
  };
  const notes = (user: string, type: string) =>
    t.asUser<{ title: string; body: string; data: { url: string } }>(
      user,
      'select title, body, data from public.notifications where type = $1 order by created_at',
      [type],
    );
  const feedTypes = async (user: string) =>
    (await t.asUser<{ type: string; payload: Record<string, unknown> }>(user, 'select type, payload from public.list_feed(50)')).filter(
      (r) => r.type === 'joint_completed',
    );

  before(async () => {
    t = await createTestDb();
    ({ a: diego, b: david } = await createFriends(t, { email: 'diego@example.com', fullName: 'Diego' }, { email: 'david@example.com', fullName: 'David' }));
    marta = await t.createUser({ email: 'marta@example.com', fullName: 'Marta' });
    await t.admin(`insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [diego, marta]);
    stranger = await t.createUser({ email: 'stranger@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('an open quedada needs no invitees, tells every friend and lists only for friends', async () => {
    const id = await propose(diego, [], { isOpen: true });
    const [open] = await notes(david, 'joint_open');
    assert.equal(open?.title, 'Diego abre una quedada');
    assert.equal(open?.data.url, `/joint/${id}`);
    assert.equal((await notes(marta, 'joint_open')).length, 1);
    assert.equal((await notes(stranger, 'joint_open')).length, 0);

    const [list] = await t.asUser<{ v: SessionJson[] }>(david, 'select public.list_open_joint_sessions($1, $2) as v', [isoDay(0), isoDay(14)]);
    assert.deepEqual(list?.v.map((s) => s.id), [id]);
    assert.equal(list?.v[0]?.isOpen, true);
    const [none] = await t.asUser<{ v: SessionJson[] }>(stranger, 'select public.list_open_joint_sessions($1, $2) as v', [isoDay(0), isoDay(14)]);
    assert.deepEqual(none?.v, []);

    // A closed quedada still needs at least one invitee.
    await assert.rejects(
      t.asUser(diego, 'select public.propose_joint_session($1::jsonb, $2::uuid[])', [draft(), []]),
      pgError({ message: 'Invita al menos a un amigo' }),
    );
  });

  test('joining an open quedada links a workout, confirms it and notifies the organizer', async () => {
    const id = await propose(diego, [], { isOpen: true, title: 'Series abiertas' });
    const [joined] = await t.asUser<{ s: SessionJson }>(david, 'select public.join_joint_session($1) as s', [id]);
    assert.equal(joined?.s.status, 'confirmed');
    const me = joined?.s.participants.find((p) => p.userId === david);
    assert.equal(me?.status, 'accepted');
    assert.ok(me?.workoutId);
    const responses = await notes(diego, 'joint_response');
    assert.ok(responses.some((n) => n.title === 'David se apunta a «Series abiertas»'));

    // Idempotent, and no longer listed as open for David.
    await t.asUser(david, 'select public.join_joint_session($1)', [id]);
    const [count] = await t.admin<{ n: number }>('select count(*)::int as n from public.workouts where joint_session_id = $1 and user_id = $2', [id, david]);
    assert.equal(count?.n, 1);
    const [list] = await t.asUser<{ v: SessionJson[] }>(david, 'select public.list_open_joint_sessions($1, $2) as v', [isoDay(0), isoDay(14)]);
    assert.ok(!list?.v.some((s) => s.id === id));

    const [seen] = await t.asUser<{ s: SessionJson | null }>(marta, 'select public.get_joint_session($1) as s', [id]);
    assert.equal(seen?.s?.isOpen, true, 'friends of the organizer can open an open quedada');
    assert.deepEqual(seen?.s?.participants.map((p) => p.displayName), ['Diego'], 'only participants Marta is friends with');
    const [hidden] = await t.asUser<{ s: SessionJson | null }>(stranger, 'select public.get_joint_session($1) as s', [id]);
    assert.equal(hidden?.s, null);
    await assert.rejects(t.asUser(stranger, 'select public.join_joint_session($1)', [id]), pgError({ message: 'Quedada no encontrada' }));
    const closed = await propose(diego, [marta]);
    await assert.rejects(t.asUser(david, 'select public.join_joint_session($1)', [closed]), pgError({ message: 'Quedada no encontrada' }));
  });

  test('the organizer edits a quedada: every planned linked workout follows and the others are told', async () => {
    const id = await propose(diego, [david]);
    await t.asUser(david, 'select public.respond_joint_session($1, true)', [id]);
    const newDay = isoDay(6);
    const [edited] = await t.asUser<{ s: SessionJson }>(diego, 'select public.update_joint_session($1, $2::jsonb) as s', [
      id,
      JSON.stringify({ date: newDay, startTime: '08:15', location: 'Casa de Campo' }),
    ]);
    assert.equal(edited?.s.date, newDay);
    assert.equal(edited?.s.startTime, '08:15');
    assert.equal(edited?.s.location, 'Casa de Campo');
    assert.equal(edited?.s.title, 'Rodaje en el Retiro', 'untouched fields keep their value');

    const workouts = await t.admin<{ date: string; start_time: string }>(
      `select date::text, to_char(start_time, 'HH24:MI') as start_time from public.workouts where joint_session_id = $1`,
      [id],
    );
    assert.equal(workouts.length, 2);
    assert.ok(workouts.every((w) => w.date === newDay && w.start_time === '08:15'));

    const [updated] = await notes(david, 'joint_updated');
    assert.equal(updated?.title, 'Diego ha cambiado «Rodaje en el Retiro»');
    assert.match(updated?.body ?? '', /^Ahora es .* a las 08:15\.$/);

    await assert.rejects(
      t.asUser(david, 'select public.update_joint_session($1, $2::jsonb)', [id, JSON.stringify({ title: 'Mío' })]),
      pgError({ message: 'Solo quien organiza la quedada puede cambiarla' }),
    );
    await assert.rejects(
      t.asUser(diego, 'select public.update_joint_session($1, $2::jsonb)', [id, JSON.stringify({ date: isoDay(-3) })]),
      pgError({ message: /pasado/ }),
    );
  });

  test('participants comment on a quedada; others are notified; strangers cannot read or write', async () => {
    const id = await propose(diego, [david]);
    const [c] = await t.asUser<{ c: { body: string; displayName: string } }>(david, 'select public.add_joint_comment($1, $2) as c', [
      id,
      '  ¿Llevo geles?  ',
    ]);
    assert.equal(c?.c.body, '¿Llevo geles?');
    assert.equal(c?.c.displayName, 'David');
    const [n] = (await notes(diego, 'joint_comment')).slice(-1);
    assert.equal(n?.title, 'David en «Rodaje en el Retiro»');
    assert.equal(n?.body, '¿Llevo geles?');

    const [list] = await t.asUser<{ v: { body: string }[] }>(diego, 'select public.list_joint_comments($1) as v', [id]);
    assert.deepEqual(list?.v.map((x) => x.body), ['¿Llevo geles?']);

    await assert.rejects(t.asUser(stranger, 'select public.list_joint_comments($1)', [id]), pgError({ message: 'Quedada no encontrada' }));
    await assert.rejects(t.asUser(stranger, 'select public.add_joint_comment($1, $2)', [id, 'hola']), pgError({ message: 'Quedada no encontrada' }));
    await assert.rejects(t.asUser(david, 'select public.add_joint_comment($1, $2)', [id, '   ']), pgError({ message: 'Escribe un mensaje' }));
    await assert.rejects(t.asUser(david, 'select * from public.joint_session_comments'), pgError({ code: '42501' }));
  });

  test('"entrenasteis juntos": one feed event once both linked workouts are completed', async () => {
    const id = await propose(diego, [david], { date: isoDay(0), title: 'Tirada juntos' });
    await t.asUser(david, 'select public.respond_joint_session($1, true)', [id]);
    const workouts = await t.admin<{ id: string; user_id: string }>('select id, user_id from public.workouts where joint_session_id = $1', [id]);
    const complete = (workoutId: string) =>
      t.admin(`update public.workouts set status = 'completed', completed = '{"durationMin": 62}'::jsonb where id = $1`, [workoutId]);

    await complete(workouts.find((w) => w.user_id === diego)!.id);
    assert.equal((await feedTypes(david)).filter((e) => e.payload.jointSessionId === id).length, 0, 'not until both are done');
    await complete(workouts.find((w) => w.user_id === david)!.id);
    const events = (await feedTypes(david)).filter((e) => e.payload.jointSessionId === id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.payload.title, 'Tirada juntos');
    assert.deepEqual(events[0]?.payload.participants, ['David', 'Diego']);

    await t.admin(`update public.workouts set status = 'planned', completed = null where id = $1`, [workouts[0]!.id]);
    assert.equal((await feedTypes(david)).filter((e) => e.payload.jointSessionId === id).length, 0, 'removed when un-completed');
  });

  test('friend races: upcoming races of friends, masked by visibility', async () => {
    await t.admin(`insert into public.races (user_id, name, date, distance, priority) values ($1, 'Ironman Barcelona', $2, 'full', 'A')`, [
      david,
      isoDay(200),
    ]);
    await t.admin(`insert into public.races (user_id, name, date, distance, priority) values ($1, 'Vieja', $2, 'half', 'B')`, [david, isoDay(-10)]);
    const [r] = await t.asUser<{ v: { friendId: string; name: string | null; distance: string }[] }>(diego, 'select public.list_friend_races() as v');
    assert.deepEqual(r?.v.map((x) => [x.friendId, x.name, x.distance]), [[david, 'Ironman Barcelona', 'full']]);

    await t.admin(`update public.profiles set visibility = 'summary' where id = $1`, [david]);
    const [s] = await t.asUser<{ v: { name: string | null }[] }>(diego, 'select public.list_friend_races() as v');
    assert.equal(s?.v[0]?.name, null, "'summary' hides the race name");
    await t.admin(`update public.profiles set visibility = 'busy' where id = $1`, [david]);
    const [b] = await t.asUser<{ v: unknown[] }>(diego, 'select public.list_friend_races() as v');
    assert.deepEqual(b?.v, []);
    await t.admin(`update public.profiles set visibility = 'full' where id = $1`, [david]);
    const [x] = await t.asUser<{ v: unknown[] }>(stranger, 'select public.list_friend_races() as v');
    assert.deepEqual(x?.v, []);
  });

  test('opening an existing quedada tells friends; declined people lose the thread; comments are rate limited', async () => {
    const id = await propose(diego, [david], { title: 'Ahora abierta' });
    const before = (await notes(marta, 'joint_open')).length;
    await t.asUser(diego, 'select public.update_joint_session($1, $2::jsonb)', [id, JSON.stringify({ isOpen: true })]);
    const after = await notes(marta, 'joint_open');
    assert.equal(after.length, before + 1);
    assert.equal(after.at(-1)?.data.url, `/joint/${id}`);

    for (let i = 0; i < 5; i += 1) {
      await t.asUser(diego, 'select public.add_joint_comment($1, $2)', [id, `msg ${i}`]);
    }
    await assert.rejects(t.asUser(diego, 'select public.add_joint_comment($1, $2)', [id, 'uno más']), pgError({ message: /Vas muy rápido/ }));

    await t.asUser(david, 'select public.respond_joint_session($1, false)', [id]);
    await assert.rejects(t.asUser(david, 'select public.list_joint_comments($1)', [id]), pgError({ message: 'Quedada no encontrada' }));
  });

  test('notes edits reach the linked workouts', async () => {
    const id = await propose(diego, [david], { notes: 'viejas' });
    await t.asUser(david, 'select public.respond_joint_session($1, true)', [id]);
    await t.asUser(diego, 'select public.update_joint_session($1, $2::jsonb)', [id, JSON.stringify({ notes: 'Traed luces' })]);
    const rows = await t.admin<{ description: string | null }>('select description from public.workouts where joint_session_id = $1', [id]);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.description === 'Traed luces'));
  });

  test('at most 15 quedadas per organizer and day', async () => {
    const busy = await t.createUser({ email: 'spam@example.com', fullName: 'Spam' });
    await t.admin(`insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [busy, david]);
    for (let i = 0; i < 15; i += 1) await propose(busy, [david], { title: `Q${i}` });
    await assert.rejects(
      t.asUser(busy, 'select public.propose_joint_session($1::jsonb, $2::uuid[])', [draft({ title: 'Q16' }), [david]]),
      pgError({ message: /muchas quedadas/ }),
    );
  });

  test('svc_propose_joint_session (MCP) proposes as the given user, service role only', async () => {
    const [row] = await t.asService<{ s: SessionJson }>('select public.svc_propose_joint_session($1, $2::jsonb, $3::uuid[]) as s', [
      diego,
      draft({ title: 'Desde Claude' }),
      [david],
    ]);
    assert.equal(row?.s.title, 'Desde Claude');
    assert.deepEqual(row?.s.participants.map((p) => `${p.displayName}:${p.status}`), ['Diego:accepted', 'David:invited']);
    await assert.rejects(
      t.asService('select public.svc_propose_joint_session($1, $2::jsonb, $3::uuid[])', [diego, draft(), [stranger]]),
      pgError({ message: 'Solo puedes invitar a tus amigos' }),
    );
    await assert.rejects(
      t.asUser(diego, 'select public.svc_propose_joint_session($1, $2::jsonb, $3::uuid[])', [diego, draft(), [david]]),
      pgError({ code: '42501' }),
    );
  });
});
