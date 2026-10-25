import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, fakeStore, FRIEND, NOW, OTHER_USER, USER, workout } from '../testing/fakes.ts';
import { buildPlanningContext, NotFoundError } from './context.ts';

function seeded() {
  const state = emptyState();
  const jointId = '44444444-4444-4444-8444-444444444444';
  state.workouts.push(
    workout({ id: 'w-mon', date: '2026-10-26', sport: 'swim', title: 'Técnica', startTime: '07:00', durationMin: 45 }),
    workout({ id: 'w-sat', date: '2026-10-31', sport: 'bike', title: 'Grupeta', durationMin: 150, jointSessionId: jointId, isKey: true }),
    workout({ id: 'w-past', date: '2026-10-20', status: 'completed', durationMin: 60, completed: { durationMin: 62, rpe: 6 } }),
    workout({ id: 'w-other', userId: OTHER_USER, date: '2026-10-27' }),
  );
  state.joint.push({
    id: jointId,
    organizerId: FRIEND,
    sport: 'bike',
    date: '2026-10-31',
    startTime: '09:00',
    durationMin: 150,
    intensity: 'endurance',
    title: 'Grupeta',
    location: 'Casa de Campo',
    status: 'confirmed',
    participants: [
      { userId: FRIEND, displayName: 'Álex', status: 'accepted', workoutId: null },
      { userId: USER, displayName: 'Diego', status: 'accepted', workoutId: 'w-sat' },
    ],
  });
  state.races.push({ id: 'r1', userId: USER, name: 'Media de Valencia', date: '2027-04-18', distance: 'half', priority: 'A', location: null, goal: 'sub 5h', notes: null });
  state.events.push({ id: 'e1', userId: USER, kind: 'padel', title: 'Pádel', startDate: '2026-10-28', endDate: '2026-10-28', startTime: '20:00', durationMin: 90, severity: 2, bodyArea: null, notes: null });
  state.busy.push({ id: 'b1', userId: USER, start: '2026-10-27T08:00:00.000Z', end: '2026-10-27T13:00:00.000Z', title: 'Clases' });
  state.friends.set(USER, [{ friendId: FRIEND, username: 'alex', displayName: 'Álex' }]);
  state.metrics.push({ userId: USER, date: '2026-10-23', source: 'garmin', hrvMs: 58, restingHr: 49, sleepHours: 7.1, sleepScore: 80, bodyBattery: 70, trainingReadiness: 66, vo2max: 52, steps: 9000, stressAvg: 30, trainingStatus: 'Productive' });
  return state;
}

test('builds a compact context for the requested week (normalized to Monday)', async () => {
  const ctx = await buildPlanningContext(fakeStore(seeded()), { userId: USER, weekStart: '2026-10-29', now: NOW, detail: 'concise' });
  assert.equal(ctx.weekStart, '2026-10-26');
  assert.equal(ctx.weekEnd, '2026-11-01');
  assert.equal(ctx.today, '2026-10-24');
  assert.equal(ctx.todayWeekday, 'sábado');
  assert.deepEqual(ctx.week.workouts.map((w) => w.id), ['w-mon', 'w-sat'], 'only this user and this week, sorted');
  const sat = ctx.week.workouts[1];
  assert.deepEqual(sat.partners, ['Álex']);
  assert.equal(sat.isKey, true);
  assert.equal(sat.description, undefined, 'concise omits descriptions');
  assert.deepEqual(ctx.busy, [{ date: '2026-10-27', start: '09:00', end: '14:00' }], 'busy titles never leave the account');
  assert.ok(!JSON.stringify(ctx).includes('Clases'));
  assert.equal(ctx.lifeEvents.length, 1);
  assert.equal(ctx.races[0].daysToRace, 176);
  assert.equal(ctx.phase.phase, 'base');
  assert.equal(ctx.friends[0].name, 'Álex');
  assert.equal(ctx.jointSessions.length, 1);
  assert.equal(ctx.loadHistory.length, 6);
  assert.equal(ctx.loadHistory[5].completedSessions, 1);
  assert.equal(ctx.wellness.metrics.length, 1);
  assert.equal(ctx.nextWeek, undefined);
  assert.equal(ctx.recentSessions, undefined);
  assert.deepEqual((ctx.athlete.availability as { restDay: string }).restDay, 'lunes');
});

test('detailed mode adds descriptions, next week and recent sessions', async () => {
  const ctx = await buildPlanningContext(fakeStore(seeded()), { userId: USER, now: NOW, detail: 'detailed', includeNextWeek: true });
  assert.equal(ctx.weekStart, '2026-10-19');
  assert.ok(ctx.nextWeek);
  assert.equal(ctx.nextWeek?.weekStart, '2026-10-26');
  assert.equal(ctx.nextWeek?.workouts.length, 2);
  assert.ok(Array.isArray(ctx.recentSessions));
  assert.ok('description' in ctx.week.workouts[0]);
});

test('throws NotFoundError without a profile', async () => {
  const state = emptyState();
  state.profiles = [];
  await assert.rejects(buildPlanningContext(fakeStore(state), { userId: USER, now: NOW, detail: 'concise' }), NotFoundError);
});
