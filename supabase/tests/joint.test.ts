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

interface JointSessionJson {
  id: string;
  organizerId: string;
  sport: string;
  date: string;
  startTime: string | null;
  durationMin: number;
  intensity: string;
  title: string;
  status: string;
  participants: Participant[];
}

interface WorkoutRow {
  id: string;
  user_id: string;
  date: string;
  start_time: string | null;
  status: string;
  source: string;
  joint_session_id: string | null;
}

const DAY = isoDay(5);

const draft = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    sport: 'bike',
    date: DAY,
    startTime: '09:00',
    durationMin: 150,
    intensity: 'endurance',
    title: 'Tirada larga juntos',
    location: 'Casa de Campo',
    ...overrides,
  });

describe('joint sessions (quedadas)', () => {
  let t: TestDb;
  let diego: string;
  let alex: string;
  let marta: string;
  let stranger: string;

  const propose = async (by: string, invitees: string[], overrides: Record<string, unknown> = {}, fromWorkout: string | null = null) => {
    const [row] = await t.asUser<{ id: string }>(
      by,
      'select public.propose_joint_session($1::jsonb, $2::uuid[], $3) as id',
      [draft(overrides), invitees, fromWorkout],
    );
    assert.ok(row?.id);
    return row.id;
  };
  const getSession = async (as: string, id: string): Promise<JointSessionJson | null> => {
    const [row] = await t.asUser<{ s: JointSessionJson | null }>(as, 'select public.get_joint_session($1) as s', [id]);
    return row?.s ?? null;
  };
  const linkedWorkouts = (sessionId: string) =>
    t.admin<WorkoutRow>(
      `select id, user_id, date::text, to_char(start_time, 'HH24:MI') as start_time, status, source, joint_session_id
       from public.workouts where joint_session_id = $1 order by user_id`,
      [sessionId],
    );
  const notes = (user: string, type: string) =>
    t.asUser<{ title: string; body: string; data: { url: string } }>(
      user,
      'select title, body, data from public.notifications where type = $1 order by created_at',
      [type],
    );

  before(async () => {
    t = await createTestDb();
    ({ a: diego, b: alex } = await createFriends(t, { email: 'diego@example.com', fullName: 'Diego' }, { email: 'alex@example.com', fullName: 'Álex' }));
    marta = await t.createUser({ email: 'marta@example.com', fullName: 'Marta' });
    await t.admin(`insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [diego, marta]);
    stranger = await t.createUser({ email: 'stranger@example.com' });
  });

  after(async () => {
    await t.close();
  });

  test('propose creates the session, participants, the organizer workout and invite notifications', async () => {
    const id = await propose(diego, [alex, marta]);
    const session = await getSession(diego, id);
    assert.equal(session?.status, 'proposed');
    assert.equal(session?.organizerId, diego);
    assert.equal(session?.startTime, '09:00');
    assert.equal(session?.date, DAY);
    const participants = session?.participants ?? [];
    assert.deepEqual([participants[0]?.displayName, participants[0]?.status], ['Diego', 'accepted'], 'organizer first');
    assert.deepEqual(
      participants.slice(1).map((p) => `${p.displayName}:${p.status}`).sort(),
      ['Marta:invited', 'Álex:invited'],
    );

    const workouts = await linkedWorkouts(id);
    assert.equal(workouts.length, 1);
    assert.equal(workouts[0]?.user_id, diego);
    assert.equal(workouts[0]?.source, 'joint');
    assert.equal(session?.participants.find((p) => p.userId === diego)?.workoutId, workouts[0]?.id);

    const [invite] = await notes(alex, 'joint_invite');
    assert.equal(invite?.title, 'Diego te invita a entrenar');
    assert.match(invite?.body ?? '', /^Tirada larga juntos · \S+ \d+ \S+ a las 09:00$/);
    assert.equal(invite?.data.url, `/joint/${id}`);

    // Visible to participants only.
    assert.equal((await t.asUser(alex, 'select * from public.joint_sessions where id = $1', [id])).length, 1);
    assert.equal((await t.asUser(stranger, 'select * from public.joint_sessions where id = $1', [id])).length, 0);
    assert.equal(await getSession(stranger, id), null);
  });

  test('accept creates the invitee workout, confirms the session, notifies the organizer and posts to the feed', async () => {
    const id = await propose(diego, [alex]);
    await t.asUser(alex, 'select public.respond_joint_session($1, true)', [id]);

    const session = await getSession(alex, id);
    assert.equal(session?.status, 'confirmed');
    const workouts = await linkedWorkouts(id);
    assert.deepEqual(workouts.map((w) => w.user_id).sort(), [diego, alex].sort());
    const alexWorkout = workouts.find((w) => w.user_id === alex);
    assert.equal(alexWorkout?.date, DAY);
    assert.equal(alexWorkout?.start_time, '09:00');
    assert.equal(session?.participants.find((p) => p.userId === alex)?.workoutId, alexWorkout?.id);

    const responses = await notes(diego, 'joint_response');
    assert.equal(responses.at(-1)?.title, 'Álex se apunta a «Tirada larga juntos»');

    const feed = await t.asUser<{ type: string; payload: { jointSessionId: string } }>(
      alex,
      `select type, payload from public.list_feed() where type = 'joint_confirmed'`,
    );
    assert.ok(feed.some((f) => f.payload.jointSessionId === id));

    // Accepting twice is a no-op.
    await t.asUser(alex, 'select public.respond_joint_session($1, true)', [id]);
    assert.equal((await linkedWorkouts(id)).length, 2);
  });

  test('decline removes the invitee planned workout and reverts to proposed when nobody else accepted', async () => {
    const id = await propose(diego, [alex]);
    await t.asUser(alex, 'select public.respond_joint_session($1, true)', [id]);
    await t.asUser(alex, 'select public.respond_joint_session($1, false)', [id]);
    const session = await getSession(diego, id);
    assert.equal(session?.status, 'proposed');
    assert.equal(session?.participants.find((p) => p.userId === alex)?.status, 'declined');
    assert.deepEqual((await linkedWorkouts(id)).map((w) => w.user_id), [diego]);
    assert.equal((await notes(diego, 'joint_response')).at(-1)?.title, 'Álex no puede ir a «Tirada larga juntos»');
    // Changing their mind again works.
    await t.asUser(alex, 'select public.respond_joint_session($1, true)', [id]);
    assert.equal((await getSession(diego, id))?.status, 'confirmed');
  });

  test('cancel: organizer only; deletes others planned workouts, unlinks the organizer one, notifies', async () => {
    const id = await propose(diego, [alex, marta]);
    await t.asUser(alex, 'select public.respond_joint_session($1, true)', [id]);
    await t.asUser(marta, 'select public.respond_joint_session($1, false)', [id]);
    const before = await linkedWorkouts(id);
    const organizerWorkout = before.find((w) => w.user_id === diego);
    const alexWorkout = before.find((w) => w.user_id === alex);

    await assert.rejects(t.asUser(alex, 'select public.cancel_joint_session($1)', [id]), pgError({ hint: 'forbidden' }));
    await assert.rejects(t.asUser(stranger, 'select public.cancel_joint_session($1)', [id]), pgError({ hint: 'not_found' }));
    const martaNotesBefore = (await notes(marta, 'joint_cancelled')).length;
    await t.asUser(diego, 'select public.cancel_joint_session($1)', [id]);

    assert.equal((await getSession(diego, id))?.status, 'cancelled');
    assert.equal((await linkedWorkouts(id)).length, 0);
    const [kept] = await t.admin<WorkoutRow>('select id, joint_session_id from public.workouts where id = $1', [organizerWorkout?.id]);
    assert.ok(kept, 'organizer workout kept');
    assert.equal(kept.joint_session_id, null);
    assert.equal((await t.admin('select 1 from public.workouts where id = $1', [alexWorkout?.id])).length, 0);

    const [cancelled] = await notes(alex, 'joint_cancelled');
    assert.equal(cancelled?.title, 'Quedada cancelada');
    assert.match(cancelled?.body ?? '', /^Diego ha cancelado «Tirada larga juntos»/);
    assert.equal((await notes(marta, 'joint_cancelled')).length, martaNotesBefore, 'declined participant not notified');

    await assert.rejects(t.asUser(alex, 'select public.respond_joint_session($1, true)', [id]), pgError({ hint: 'conflict' }));
    await t.asUser(diego, 'select public.cancel_joint_session($1)', [id]); // idempotent
  });

  test('propose can link an existing planned workout (aligning its date/time)', async () => {
    const [w] = await t.asUser<{ id: string }>(
      diego,
      `insert into public.workouts (date, start_time, sport, title, duration_min, intensity) values ($1, '07:00', 'run', 'Rodaje', 50, 'endurance') returning id`,
      [isoDay(4)],
    );
    const id = await propose(diego, [alex], { sport: 'run', startTime: '18:00', durationMin: 50, title: 'Rodaje juntos' }, w?.id ?? null);
    const workouts = await linkedWorkouts(id);
    assert.equal(workouts.length, 1);
    assert.equal(workouts[0]?.id, w?.id);
    assert.equal(workouts[0]?.date, DAY);
    assert.equal(workouts[0]?.start_time, '18:00');
    await assert.rejects(propose(diego, [alex], {}, w?.id ?? null), pgError({ hint: 'not_found' }), 'already linked');
    const [other] = await t.asUser<{ id: string }>(
      alex,
      `insert into public.workouts (date, sport, title, duration_min, intensity) values ($1, 'run', 'De Álex', 50, 'endurance') returning id`,
      [DAY],
    );
    await assert.rejects(propose(diego, [alex], {}, other?.id ?? null), pgError({ hint: 'not_found' }), 'someone else workout');
  });

  test('validation: invitees must be accepted friends; drafts are checked', async () => {
    await assert.rejects(propose(diego, [stranger]), pgError({ hint: 'forbidden' }));
    await assert.rejects(propose(diego, []), pgError({ hint: 'validation' }));
    await assert.rejects(propose(diego, [diego]), pgError({ hint: 'validation' }));
    await assert.rejects(propose(diego, [alex], { sport: 'rest' }), pgError({ message: 'Deporte no válido' }));
    await assert.rejects(propose(diego, [alex], { date: '2026-02-30' }), pgError({ message: 'Fecha inválida' }));
    await assert.rejects(propose(diego, [alex], { date: isoDay(-10) }), pgError({ hint: 'validation' }));
    await assert.rejects(propose(diego, [alex], { startTime: '9:00' }), pgError({ message: 'Hora inválida' }));
    await assert.rejects(propose(diego, [alex], { durationMin: 2 }), pgError({ message: 'Duración inválida' }));
    await assert.rejects(propose(diego, [alex], { title: '   ' }), pgError({ message: 'Título vacío' }));
    const id = await propose(diego, [alex, alex], { startTime: null });
    assert.equal((await getSession(diego, id))?.participants.length, 2, 'duplicate invitees collapse');
    assert.equal((await getSession(diego, id))?.startTime, null);
  });

  test('responding: organizer and outsiders cannot respond', async () => {
    const id = await propose(diego, [alex]);
    await assert.rejects(t.asUser(diego, 'select public.respond_joint_session($1, true)', [id]), pgError({ hint: 'validation' }));
    await assert.rejects(t.asUser(stranger, 'select public.respond_joint_session($1, true)', [id]), pgError({ hint: 'not_found' }));
  });

  test('list_joint_sessions returns the caller sessions in range as camelCase JSON', async () => {
    const [row] = await t.asUser<{ list: JointSessionJson[] }>(
      marta,
      'select public.list_joint_sessions($1, $2) as list',
      [isoDay(0), isoDay(30)],
    );
    const list = row?.list ?? [];
    assert.ok(list.length >= 1);
    assert.ok(list.every((s) => s.participants.some((p) => p.userId === marta)));
    const sample = list[0];
    assert.deepEqual(Object.keys(sample ?? {}).sort(), [
      'createdAt', 'date', 'durationMin', 'id', 'intensity', 'location', 'notes', 'organizerId',
      'participants', 'sport', 'startTime', 'status', 'title',
    ]);
    const [none] = await t.asUser<{ list: unknown[] }>(stranger, 'select public.list_joint_sessions($1, $2) as list', [isoDay(0), isoDay(30)]);
    assert.deepEqual(none?.list, []);
    await assert.rejects(
      t.asUser(marta, 'select public.list_joint_sessions($1, $2)', [isoDay(10), isoDay(0)]),
      pgError({ hint: 'validation' }),
    );
  });
});
