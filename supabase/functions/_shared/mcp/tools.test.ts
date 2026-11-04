import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { StoreRejectedError } from '../planning/store.ts';
import { emptyState, fakeStore, fixedNow, FRIEND, OTHER_USER, USER, workout } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import type { ToolResult } from './tool.ts';
import { createToolRegistry } from './tools/index.ts';

const registry = createToolRegistry();

async function run(state: FakeState, name: string, args: unknown, applyFailed = false): Promise<ToolResult> {
  const tool = registry.get(name);
  assert.ok(tool, name);
  const store = fakeStore(state, applyFailed ? { applied: 0, failed: [{ index: 0, error: 'x' }] } : undefined);
  return tool.run(args, { userId: USER, store, now: fixedNow, logger: silentLogger });
}

const text = (r: ToolResult): string => r.content[0].text;
const PLANNED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function withWeek(): FakeState {
  const state = emptyState();
  state.workouts.push(
    workout({ id: PLANNED_ID, date: '2026-10-27', sport: 'run', title: 'Series 6x1000', intensity: 'threshold', durationMin: 60, isKey: true }),
    workout({ date: '2026-10-29', sport: 'swim', title: 'Natación', durationMin: 45, startTime: null }),
    workout({ userId: OTHER_USER, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date: '2026-10-28' }),
  );
  return state;
}

test('propose_plan_changes stores a pending camelCase proposal with source claude', async () => {
  const state = withWeek();
  const r = await run(state, 'propose_plan_changes', {
    week_start: '2026-10-28',
    summary: 'Muevo las series por el pádel del martes.',
    changes: [
      { op: 'move', workoutId: PLANNED_ID, toDate: '2026-10-30', reason: 'Pádel el martes' },
      { op: 'add', workout: { date: '2026-11-01', sport: 'run', title: 'Tirada larga', durationMin: 80, intensity: 'endurance' }, reason: 'Fondo' },
    ],
  });
  assert.equal(r.isError, undefined, text(r));
  assert.equal(state.proposals.length, 1);
  const p = state.proposals[0];
  assert.equal(p.source, 'claude');
  assert.equal(p.weekStart, '2026-10-26');
  assert.equal(p.kind, 'replan');
  assert.deepEqual(p.changes[0], { op: 'move', workoutId: PLANNED_ID, toDate: '2026-10-30', reason: 'Pádel el martes' });
  assert.equal(p.changes[1].op === 'add' && p.changes[1].workout.source, 'claude');
  assert.equal(state.applied.length, 0, 'pending by default');
  assert.equal((r.structuredContent as { status: string }).status, 'pending');
});

test('propose_plan_changes rejects foreign or unknown ids and lists valid ones', async () => {
  const state = withWeek();
  const r = await run(state, 'propose_plan_changes', {
    week_start: '2026-10-26',
    summary: 'x',
    changes: [{ op: 'delete', workoutId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reason: 'no' }],
  });
  assert.equal(r.isError, true);
  assert.match(text(r), /no existe/);
  assert.match(text(r), new RegExp(PLANNED_ID));
  assert.equal(state.proposals.length, 0, 'nothing stored when a change is invalid');
});

test('propose_plan_changes with apply_now applies through svc_apply_plan_changes', async () => {
  const state = withWeek();
  const r = await run(state, 'propose_plan_changes', {
    week_start: '2026-10-26',
    summary: 'Recorto',
    changes: [{ op: 'update', workoutId: PLANNED_ID, patch: { durationMin: 40, intensity: 'tempo' }, reason: 'Fatiga' }],
    apply_now: true,
  });
  assert.equal(state.applied.length, 1);
  assert.equal(state.applied[0].proposalId, state.proposals[0].id);
  assert.equal((r.structuredContent as { status: string }).status, 'applied');
  const failed = await run(withWeek(), 'propose_plan_changes', {
    week_start: '2026-10-26',
    summary: 'x',
    changes: [{ op: 'delete', workoutId: PLANNED_ID, reason: 'x' }],
    apply_now: true,
  }, true);
  assert.equal((failed.structuredContent as { status: string }).status, 'failed');
});

test('log_life_event creates once, reports affected workouts and adds safety for injuries', async () => {
  const state = withWeek();
  const args = { kind: 'injury', title: 'Molestia gemelo', start_date: '2026-10-27', end_date: '2026-10-29', severity: 2, body_area: 'calf' };
  const first = await run(state, 'log_life_event', args);
  const sc = first.structuredContent as { created: boolean; affectedWorkouts: { id: string }[]; safety?: string };
  assert.equal(sc.created, true);
  assert.equal(sc.affectedWorkouts.length, 2);
  assert.ok(sc.safety);
  const second = await run(state, 'log_life_event', args);
  assert.equal((second.structuredContent as { created: boolean }).created, false);
  assert.equal(state.events.length, 1);
  const bad = await run(state, 'log_life_event', { ...args, end_date: '2026-10-20' });
  assert.equal(bad.isError, true);
});

test('log_daily_metrics upserts only provided fields with Garmin attribution', async () => {
  const state = emptyState();
  const r = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24', hrv_ms: 61, training_readiness: 72 }, { date: '2026-10-23', resting_hr: 48 }] });
  assert.equal(r.isError, undefined, text(r));
  const rows = state.metricUpserts[0].rows;
  assert.equal(rows[0].hrvMs, 61);
  assert.equal(rows[0].trainingReadiness, 72);
  assert.equal('restingHr' in rows[0], false);
  assert.equal(rows[0].raw.source, 'Garmin');
  const future = await run(state, 'log_daily_metrics', { days: [{ date: '2026-12-01', hrv_ms: 50 }] });
  assert.equal(future.isError, true);
  const empty = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24' }] });
  assert.equal(empty.isError, true);
  const outOfRange = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24', hrv_ms: 900 }] });
  assert.equal(outOfRange.isError, true);
});

test('log_daily_metrics accepts sleep stages and start/end (normalized to UTC instants)', async () => {
  const state = emptyState();
  const r = await run(state, 'log_daily_metrics', {
    days: [{ date: '2026-10-24', sleep_deep_min: 82, sleep_rem_min: 95, sleep_start: '2026-10-23T23:10:00+02:00', sleep_end: '2026-10-24T06:40:00+02:00' }],
  });
  assert.equal(r.isError, undefined, text(r));
  const row = state.metricUpserts[0].rows[0];
  assert.equal(row.sleepDeepMin, 82);
  assert.equal(row.sleepRemMin, 95);
  assert.equal(row.sleepStart, '2026-10-23T21:10:00.000Z');
  assert.equal(row.sleepEnd, '2026-10-24T04:40:00.000Z');
  assert.equal('sleepLightMin' in row, false);
  const backwards = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24', sleep_start: '2026-10-24T07:00:00Z', sleep_end: '2026-10-23T22:00:00Z' }] });
  assert.equal(backwards.isError, true);
  const garbage = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24', sleep_start: 'anoche' }] });
  assert.equal(garbage.isError, true);
  const tooLong = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24', sleep_awake_min: 2000 }] });
  assert.equal(tooLong.isError, true);
});

test('log_completed_activity completes the matching planned workout, else creates one, without duplicates', async () => {
  const state = emptyState();
  state.workouts.push(workout({ id: PLANNED_ID, date: '2026-10-24', sport: 'run', durationMin: 50, startTime: '08:00' }));
  const matched = await run(state, 'log_completed_activity', { date: '2026-10-24', sport: 'run', duration_min: 52, start_time: '08:10', avg_hr: 150, garmin_activity_id: '123' });
  assert.equal((matched.structuredContent as { status: string }).status, 'completed_planned');
  assert.equal(state.workouts[0].status, 'completed');
  assert.equal(state.workouts[0].completed?.externalId, '123');
  const again = await run(state, 'log_completed_activity', { date: '2026-10-24', sport: 'run', duration_min: 52, garmin_activity_id: '123' });
  assert.equal((again.structuredContent as { status: string }).status, 'already_logged');
  const padel = await run(state, 'log_completed_activity', { date: '2026-10-23', sport: 'other', duration_min: 90, title: 'Pádel', rpe: 7, garmin_activity_id: '456' });
  assert.equal((padel.structuredContent as { status: string }).status, 'created_unplanned');
  const created = state.workouts.find((w) => w.externalId === 'garmin:456');
  assert.equal(created?.intensity, 'threshold');
  const future = await run(state, 'log_completed_activity', { date: '2026-10-30', sport: 'run', duration_min: 30 });
  assert.equal(future.isError, true);
});

test('log_completed_activity does not duplicate an activity already imported from Apple Health', async () => {
  const state = emptyState();
  state.workouts.push(
    workout({ id: PLANNED_ID, date: '2026-10-24', sport: 'run', durationMin: 45, startTime: '19:00', status: 'completed', completed: { source: 'healthkit', externalId: 'HK-UUID-1', durationMin: 46 } }),
  );
  const r = await run(state, 'log_completed_activity', { date: '2026-10-24', sport: 'run', duration_min: 47, start_time: '19:02', garmin_activity_id: '123' });
  assert.deepEqual(
    { status: (r.structuredContent as { status: string }).status, workoutId: (r.structuredContent as { workoutId: string }).workoutId },
    { status: 'already_logged', workoutId: PLANNED_ID },
  );
  assert.equal(state.workouts.length, 1, 'no extra completed workout');
  const different = await run(state, 'log_completed_activity', { date: '2026-10-24', sport: 'swim', duration_min: 30 });
  assert.equal((different.structuredContent as { status: string }).status, 'created_unplanned');
});

test('get_plan_for_device returns planned workouts with Garmin JSON', async () => {
  const state = withWeek();
  const r = await run(state, 'get_plan_for_device', { from: '2026-10-26', days: 7 });
  const sc = r.structuredContent as { count: number; workouts: { garminWorkouts: Record<string, unknown>[] }[] };
  assert.equal(sc.count, 2);
  assert.equal(sc.workouts[0].garminWorkouts[0].sport, 'RUNNING');
  assert.equal(sc.workouts[0].garminWorkouts[0].scheduledDate, '2026-10-27');
});

test('manage_race creates with required fields and updates by id', async () => {
  const state = emptyState();
  const missing = await run(state, 'manage_race', { name: 'Media de Valencia' });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /date, distance, priority/);
  const created = await run(state, 'manage_race', { name: 'Media de Valencia', date: '2027-04-18', distance: 'half', priority: 'A', goal: 'sub 5h' });
  assert.equal((created.structuredContent as { action: string }).action, 'created');
  const id = state.races[0].id;
  const updated = await run(state, 'manage_race', { race_id: id, priority: 'B' });
  assert.equal((updated.structuredContent as { race: { priority: string } }).race.priority, 'B');
  const notFound = await run(state, 'manage_race', { race_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', priority: 'B' });
  assert.equal(notFound.isError, true);
});

test('get_friends_availability returns masked items, common slots and same-sport days', async () => {
  const state = withWeek();
  state.friends.set(USER, [{ friendId: FRIEND, username: 'alex', displayName: 'Álex' }]);
  state.friendWeeks.set(FRIEND, [
    { kind: 'workout', id: 'f1', date: '2026-10-27', startTime: '19:00', endTime: null, durationMin: 60, sport: 'run', intensity: 'endurance', title: 'Rodaje', status: 'planned', jointSessionId: null },
    { kind: 'busy', id: null, date: '2026-10-28', startTime: '09:00', endTime: '14:00', durationMin: null, sport: null, intensity: null, title: null, status: null, jointSessionId: null },
  ]);
  const r = await run(state, 'get_friends_availability', { week_start: '2026-10-26', min_minutes: 60 });
  const friends = (r.structuredContent as { friends: { name: string; commonSlots: unknown[]; sameSportDays: { myWorkoutId: string }[] }[] }).friends;
  assert.equal(friends.length, 1);
  assert.equal(friends[0].name, 'Álex');
  assert.ok(friends[0].commonSlots.length > 0);
  assert.equal(friends[0].sameSportDays[0].myWorkoutId, PLANNED_ID);
  const unknown = await run(state, 'get_friends_availability', { friend_ids: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'] });
  assert.equal(unknown.isError, true);
});

interface JointResult {
  created: boolean;
  next: string;
  jointSession: { id: string; isOpen: boolean; myWorkoutId: string | null; appLink: string; participants: { userId: string; status: string }[] };
}

const RODAJE = {
  friend_ids: [FRIEND],
  sport: 'run',
  date: '2026-10-31',
  start_time: '09:00',
  duration_min: 60,
  intensity: 'endurance',
  title: 'Rodaje del sábado',
  location: 'Retiro, puerta de Alcalá',
};

function withFriend(): FakeState {
  const state = emptyState();
  state.friends.set(USER, [{ friendId: FRIEND, username: 'david', displayName: 'David' }]);
  return state;
}

test('propose_joint_session creates the quedada, links my workout and invites the friend', async () => {
  const state = withFriend();
  const r = await run(state, 'propose_joint_session', RODAJE);
  assert.equal(r.isError, undefined, text(r));
  const sc = r.structuredContent as unknown as JointResult;
  assert.equal(sc.created, true);
  assert.equal(state.joint.length, 1);
  assert.deepEqual(
    sc.jointSession.participants.map((p) => [p.userId, p.status]),
    [[USER, 'accepted'], [FRIEND, 'invited']],
  );
  const linked = state.workouts.find((w) => w.jointSessionId === sc.jointSession.id);
  assert.equal(sc.jointSession.myWorkoutId, linked?.id);
  assert.equal(sc.jointSession.appLink, `roadtoironman://joint/${sc.jointSession.id}`);
  assert.match(sc.next, /David/);
  const tool = registry.get('propose_joint_session');
  assert.equal(tool?.annotations.readOnlyHint, false);
  assert.equal(tool?.annotations.destructiveHint, false);
  assert.match(tool?.description ?? '', /invitación real/);
});

test('propose_joint_session: open quedada without friends; closed one needs a friend', async () => {
  const state = withFriend();
  const { friend_ids: _omit, ...noFriends } = RODAJE;
  const open = await run(state, 'propose_joint_session', { ...noFriends, is_open: true });
  assert.equal(open.isError, undefined, text(open));
  const sc = open.structuredContent as unknown as JointResult;
  assert.equal(sc.jointSession.isOpen, true);
  assert.equal(sc.jointSession.participants.length, 1);
  const closed = await run(state, 'propose_joint_session', { ...noFriends, title: 'Otra' });
  assert.equal(closed.isError, true);
  assert.match(text(closed), /al menos un amigo/);
  assert.equal(state.joint.length, 1);
});

test('propose_joint_session rejects past dates and more than 60 days ahead', async () => {
  const state = withFriend();
  const past = await run(state, 'propose_joint_session', { ...RODAJE, date: '2026-10-23' });
  assert.equal(past.isError, true);
  assert.match(text(past), /pasado/);
  const far = await run(state, 'propose_joint_session', { ...RODAJE, date: '2026-12-24' });
  assert.equal(far.isError, true);
  assert.match(text(far), /60 días/);
  const fake = await run(state, 'propose_joint_session', { ...RODAJE, date: '2026-02-30' });
  assert.equal(fake.isError, true);
  const rest = await run(state, 'propose_joint_session', { ...RODAJE, sport: 'rest' });
  assert.equal(rest.isError, true);
  assert.equal(state.joint.length, 0);
  const limit = await run(state, 'propose_joint_session', { ...RODAJE, date: '2026-12-23' });
  assert.equal(limit.isError, undefined, text(limit));
});

test('propose_joint_session only invites accepted friends and surfaces database refusals', async () => {
  const state = withFriend();
  const stranger = await run(state, 'propose_joint_session', { ...RODAJE, friend_ids: [OTHER_USER] });
  assert.equal(stranger.isError, true);
  assert.match(text(stranger), new RegExp(OTHER_USER));
  assert.match(text(stranger), /David/);
  const tool = registry.get('propose_joint_session');
  assert.ok(tool);
  const store = {
    ...fakeStore(state),
    proposeJointSession: async () => Promise.reject(new StoreRejectedError('forbidden', 'Solo puedes invitar a tus amigos')),
  };
  const refused = await tool.run(RODAJE, { userId: USER, store, now: fixedNow, logger: silentLogger });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /Solo puedes invitar a tus amigos/);
  assert.equal(state.joint.length, 0);
});

test('propose_joint_session returns the existing quedada instead of inviting twice', async () => {
  const state = withFriend();
  const first = await run(state, 'propose_joint_session', RODAJE);
  const again = await run(state, 'propose_joint_session', { ...RODAJE, title: '  rodaje DEL sábado ', start_time: '10:00' });
  const sc = again.structuredContent as unknown as JointResult;
  assert.equal(sc.created, false);
  assert.equal(sc.jointSession.id, (first.structuredContent as unknown as JointResult).jointSession.id);
  assert.equal(state.joint.length, 1);
  state.joint[0] = { ...state.joint[0], status: 'cancelled' };
  const afterCancel = await run(state, 'propose_joint_session', RODAJE);
  assert.equal((afterCancel.structuredContent as unknown as JointResult).created, true);
  assert.equal(state.joint.length, 2);
});

test('handler crashes become generic isError results', async () => {
  const tool = registry.get('get_planning_context');
  assert.ok(tool);
  const store = fakeStore(emptyState());
  const broken = { ...store, getProfile: async () => Promise.reject(new Error('db down')) };
  const r = await tool.run({}, { userId: USER, store: broken, now: fixedNow, logger: silentLogger });
  assert.equal(r.isError, true);
  assert.match(text(r), /error interno/);
});
