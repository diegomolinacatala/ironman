import assert from 'node:assert/strict';
import test from 'node:test';
import { workout } from '../testing/fakes.ts';
import type { PlanChange } from '../types.ts';
import { checkChanges, planChangeSchema, planChangesSchema, proposalKindFor, withSource } from './changes.ts';

const planned = workout({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date: '2026-10-27', title: 'Series' });
const done = workout({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date: '2026-10-26', status: 'completed', title: 'Natación' });
const ctx = { weekStart: '2026-10-26', today: '2026-10-27', workouts: [planned, done] };

const add = (date: string): PlanChange => ({
  op: 'add',
  workout: { date, sport: 'bike', title: 'Bici Z2', durationMin: 90, intensity: 'endurance' },
  reason: 'Volumen aeróbico',
});

test('planChangeSchema accepts the camelCase PlanChange contract', () => {
  const r = planChangesSchema.parse([
    add('2026-10-28'),
    { op: 'move', workoutId: planned.id, toDate: '2026-10-29', toStartTime: null, reason: 'Clase' },
    { op: 'update', workoutId: planned.id, patch: { durationMin: 40 }, reason: 'Fatiga' },
    { op: 'delete', workoutId: planned.id, reason: 'Pádel' },
  ]);
  assert.equal(r.ok, true);
});

test('planChangeSchema rejects bad shapes with actionable paths', () => {
  const bad = planChangeSchema.parse({ op: 'add', workout: { date: '2026-10-28', sport: 'yoga', title: 'X', durationMin: 30, intensity: 'endurance' }, reason: 'r' }, 'changes[0]');
  assert.ok(!bad.ok && bad.error.startsWith('changes[0].workout.sport'));
  const tooLong = planChangeSchema.parse({ op: 'add', workout: { date: '2026-10-28', sport: 'run', title: 'X', durationMin: 800, intensity: 'endurance' }, reason: 'r' });
  assert.equal(tooLong.ok, false);
  const noReason = planChangeSchema.parse({ op: 'delete', workoutId: planned.id });
  assert.equal(noReason.ok, false);
  const badId = planChangeSchema.parse({ op: 'delete', workoutId: 's_81', reason: 'x' });
  assert.equal(badId.ok, false);
  const source = planChangeSchema.parse({ op: 'add', workout: { date: '2026-10-28', sport: 'run', title: 'X', durationMin: 30, intensity: 'endurance', source: 'manual' }, reason: 'r' });
  assert.equal(source.ok, false, 'source is set by the server, not by Claude');
});

test('checkChanges enforces window, past dates, ownership and planned status', () => {
  const { valid, issues } = checkChanges(
    [
      add('2026-10-28'),
      add('2026-11-09'),
      add('2026-10-26'),
      { op: 'move', workoutId: done.id, toDate: '2026-10-28', reason: 'x' },
      { op: 'delete', workoutId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'x' },
      { op: 'update', workoutId: planned.id, patch: {}, reason: 'x' },
      { op: 'delete', workoutId: planned.id, reason: 'x' },
      { op: 'update', workoutId: planned.id, patch: { title: 'Y' }, reason: 'x' },
      add('2026-02-30'),
    ],
    ctx,
  );
  assert.equal(valid.length, 2);
  assert.deepEqual(issues.map((i) => i.index), [1, 2, 3, 4, 5, 7, 8]);
  assert.match(issues[0].error, /fuera de la ventana/);
  assert.match(issues[1].error, /ya ha pasado/);
  assert.match(issues[2].error, /completado/);
  assert.match(issues[3].error, /no existe/);
  assert.match(issues[4].error, /patch vacío/);
  assert.match(issues[5].error, /ya se elimina/);
  assert.match(issues[6].error, /no existe/);
});

test('withSource stamps added workouts immutably and proposalKindFor derives the kind', () => {
  const input = [add('2026-10-28')];
  const out = withSource(input, 'claude');
  assert.equal(out[0].op === 'add' && out[0].workout.source, 'claude');
  assert.equal(input[0].op === 'add' && input[0].workout.source, undefined);
  assert.equal(proposalKindFor(out), 'generate_week');
  assert.equal(proposalKindFor([...out, { op: 'delete', workoutId: planned.id, reason: 'x' }]), 'replan');
});
