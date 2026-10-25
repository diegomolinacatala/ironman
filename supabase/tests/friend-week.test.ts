import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createFriends, createTestDb, pgError } from './harness.ts';
import type { TestDb } from './harness.ts';

interface Item {
  kind: string;
  id: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_min: number | null;
  sport: string | null;
  intensity: string | null;
  title: string | null;
  status: string | null;
  joint_session_id: string | null;
}

const FROM = '2026-11-02';
const TO = '2026-11-08';
const SECRET_TITLES = ['Clase de anatomía', 'Lesión rodilla', 'Estrés exámenes', 'Reunión', 'Notas privadas'];

const WEEK_SQL = `
  select kind, id, date::text as date,
    to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time,
    duration_min, sport, intensity, title, status, joint_session_id
  from public.get_friend_week($1, $2, $3)`;

describe('get_friend_week masking', () => {
  let t: TestDb;
  let viewer: string;
  let friend: string;
  let workoutA: string;

  const setVisibility = (visibility: string) =>
    t.admin('update public.profiles set visibility = $2 where id = $1', [friend, visibility]);
  const week = () => t.asUser<Item>(viewer, WEEK_SQL, [friend, FROM, TO]);
  const brief = (items: Item[]) =>
    items.map((i) => `${i.kind} ${i.date} ${i.start_time ?? '-'}-${i.end_time ?? '-'} ${i.duration_min ?? '-'} ${i.title ?? '·'}`);

  before(async () => {
    t = await createTestDb();
    ({ a: viewer, b: friend } = await createFriends(t, { email: 'viewer@example.com' }, { email: 'friend@example.com' }));

    const [a] = await t.admin<{ id: string }>(
      `insert into public.workouts (user_id, date, start_time, sport, title, description, duration_min, intensity)
       values ($1, '2026-11-03', '18:30', 'run', 'Series secretas', 'Notas privadas', 60, 'threshold') returning id`,
      [friend],
    );
    workoutA = a?.id ?? '';
    await t.admin(
      `insert into public.workouts (user_id, date, start_time, sport, title, duration_min, intensity, status) values
         ($1, '2026-11-04', null, 'swim', 'Natación', 45, 'endurance', 'planned'),
         ($1, '2026-11-05', '23:30', 'bike', 'Rodillo nocturno', 90, 'endurance', 'planned'),
         ($1, '2026-11-06', '07:00', 'run', 'Saltado', 30, 'recovery', 'skipped')`,
      [friend],
    );
    await t.admin(
      `insert into public.busy_blocks (user_id, starts_at, ends_at, title) values
         ($1, '2026-11-03 08:00 Europe/Madrid', '2026-11-03 14:00 Europe/Madrid', 'Clase de anatomía'),
         ($1, '2026-11-06 22:00 Europe/Madrid', '2026-11-07 02:00 Europe/Madrid', 'Reunión')`,
      [friend],
    );
    await t.admin(
      `insert into public.life_events (user_id, kind, title, start_date, end_date, start_time, duration_min) values
         ($1, 'padel', 'Pádel con Juan', '2026-11-05', '2026-11-05', '20:00', 90),
         ($1, 'injury', 'Lesión rodilla', '2026-11-04', '2026-11-06', null, null),
         ($1, 'stress', 'Estrés exámenes', '2026-11-03', '2026-11-03', null, null),
         ($1, 'work', 'Reunión', '2026-11-04', '2026-11-04', '10:00', 60),
         ($1, 'travel', 'Viaje a Bilbao', '2026-11-07', '2026-11-08', null, null)`,
      [friend],
    );
  });

  after(async () => {
    await t.close();
  });

  const assertNoSecrets = (items: Item[]) => {
    const text = JSON.stringify(items);
    for (const secret of SECRET_TITLES) assert.ok(!text.includes(secret), `leaked "${secret}"`);
  };

  test('full: workouts and shareable events with titles, busy blocks without titles', async () => {
    await setVisibility('full');
    const items = await week();
    assertNoSecrets(items);
    assert.deepEqual(brief(items), [
      'busy 2026-11-03 08:00-14:00 360 ·',
      'workout 2026-11-03 18:30-19:30 60 Series secretas',
      'workout 2026-11-04 --- 45 Natación',
      'event 2026-11-05 20:00-21:30 90 Pádel con Juan',
      'workout 2026-11-05 23:30-23:59 90 Rodillo nocturno',
      'workout 2026-11-06 07:00-07:30 30 Saltado',
      'busy 2026-11-06 22:00-23:59 120 ·',
      'event 2026-11-07 --- - Viaje a Bilbao',
      'busy 2026-11-07 00:00-02:00 120 ·',
      'event 2026-11-08 --- - Viaje a Bilbao',
    ].sort(byDateThenTime));
    const a = items.find((i) => i.id === workoutA);
    assert.equal(a?.sport, 'run');
    assert.equal(a?.intensity, 'threshold');
    assert.equal(a?.status, 'planned');
    assert.ok(items.filter((i) => i.kind === 'busy').every((i) => i.id === null && i.title === null));
  });

  test('summary: same items, no titles at all', async () => {
    await setVisibility('summary');
    const items = await week();
    assertNoSecrets(items);
    assert.equal(items.length, 10);
    assert.ok(items.every((i) => i.title === null), 'no titles in summary');
    const a = items.find((i) => i.id === workoutA);
    assert.equal(a?.sport, 'run');
    assert.equal(a?.duration_min, 60);
    assert.equal(a?.start_time, '18:30');
    assert.ok(!items.some((i) => i.title === 'Viaje a Bilbao'));
  });

  test('busy: only anonymous busy intervals, split per day in the friend time zone', async () => {
    await setVisibility('busy');
    const items = await week();
    assertNoSecrets(items);
    assert.ok(items.every((i) => i.kind === 'busy'), 'only busy items');
    assert.ok(items.every((i) => i.id === null && i.sport === null && i.title === null && i.status === null && i.joint_session_id === null));
    assert.deepEqual(brief(items), [
      'busy 2026-11-03 08:00-14:00 360 ·',
      'busy 2026-11-03 18:30-19:30 60 ·',
      'busy 2026-11-05 20:00-21:30 90 ·',
      'busy 2026-11-05 23:30-23:59 30 ·',
      'busy 2026-11-06 00:00-01:00 60 ·',
      'busy 2026-11-06 22:00-23:59 120 ·',
      'busy 2026-11-07 00:00-02:00 120 ·',
      'busy 2026-11-07 00:00-23:59 1440 ·',
      'busy 2026-11-08 00:00-23:59 1440 ·',
    ]);
  });

  test('time zone: busy blocks are rendered in the friend zone', async () => {
    await setVisibility('busy');
    await t.admin(`update public.profiles set timezone = 'UTC' where id = $1`, [friend]);
    const items = await week();
    assert.ok(brief(items).includes('busy 2026-11-03 07:00-13:00 360 ·'));
    await t.admin(`update public.profiles set timezone = 'Europe/Madrid' where id = $1`, [friend]);
  });

  test('non-friends and pending friends are rejected', async () => {
    const stranger = await t.createUser({ email: 'stranger@example.com' });
    await assert.rejects(t.asUser(stranger, WEEK_SQL, [friend, FROM, TO]), pgError({ hint: 'forbidden' }));
    await t.admin(`insert into public.friendships (requester_id, addressee_id) values ($1, $2)`, [stranger, friend]);
    await assert.rejects(t.asUser(stranger, WEEK_SQL, [friend, FROM, TO]), pgError({ hint: 'forbidden' }));
    await assert.rejects(t.asUser(friend, WEEK_SQL, [stranger, FROM, TO]), pgError({ hint: 'forbidden' }));
    await assert.rejects(t.asUser(viewer, WEEK_SQL, [viewer, FROM, TO]), pgError({ hint: 'forbidden' }), 'self is not a friend');
  });

  test('range is validated (1..31 days)', async () => {
    await assert.rejects(t.asUser(viewer, WEEK_SQL, [friend, TO, FROM]), pgError({ hint: 'validation' }));
    await assert.rejects(t.asUser(viewer, WEEK_SQL, [friend, '2026-11-01', '2026-12-02']), pgError({ hint: 'validation' }));
    const ok = await t.asUser<Item>(viewer, WEEK_SQL, [friend, '2026-11-01', '2026-12-01']);
    assert.ok(ok.length > 0);
  });

  test('svc_get_friend_week is service-role only and enforces friendship for the viewer', async () => {
    await assert.rejects(
      t.asUser(viewer, 'select * from public.svc_get_friend_week($1, $2, $3, $4)', [viewer, friend, FROM, TO]),
      pgError({ code: '42501' }),
    );
    const rows = await t.asService('select * from public.svc_get_friend_week($1, $2, $3, $4)', [viewer, friend, FROM, TO]);
    assert.ok(rows.length > 0);
    const stranger = await t.createUser({ email: 'stranger2@example.com' });
    await assert.rejects(
      t.asService('select * from public.svc_get_friend_week($1, $2, $3, $4)', [stranger, friend, FROM, TO]),
      pgError({ hint: 'forbidden' }),
    );
  });
});

/** Mirrors the RPC ordering: date, start time (nulls first), kind. */
function byDateThenTime(a: string, b: string): number {
  const [kindA, dateA, timeA] = a.split(' ');
  const [kindB, dateB, timeB] = b.split(' ');
  const startA = (timeA ?? '').split('-')[0] || '';
  const startB = (timeB ?? '').split('-')[0] || '';
  return (
    (dateA ?? '').localeCompare(dateB ?? '') ||
    startA.localeCompare(startB) ||
    (kindA ?? '').localeCompare(kindB ?? '')
  );
}
