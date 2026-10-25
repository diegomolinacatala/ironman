import { applyPlanChanges, describeChange, validateDraft } from '../changes';
import type { PlanChange } from '../types';
import { makeWorkout } from './fixtures';

function ctx() {
  let n = 0;
  return { userId: 'me', now: '2026-10-25T10:00:00', newId: () => `id-${(n += 1)}` };
}

describe('validateDraft', () => {
  test('full and partial validation', () => {
    expect(validateDraft({ date: '2026-10-27', title: 'X', durationMin: 30 }, false)).toBeNull();
    expect(validateDraft({ title: 'X', durationMin: 30 }, false)).toBe('Fecha inválida');
    expect(validateDraft({ date: '2026-10-27', durationMin: 30, title: '  ' }, false)).toBe('Título vacío');
    expect(validateDraft({ date: '2026-10-27', title: 'X', durationMin: -1 }, false)).toBe('Duración inválida');
    expect(validateDraft({ startTime: '25:00' }, true)).toBe('Hora inválida');
    expect(validateDraft({}, true)).toBeNull();
  });
});

describe('applyPlanChanges', () => {
  const planned = makeWorkout({ id: 'p', title: 'Rodaje', date: '2026-10-27', startTime: '07:00' });
  const done = makeWorkout({ id: 'd', title: 'Hecho', status: 'completed' });

  test('add, move, update, delete — immutably, in order', () => {
    const input = [planned, done];
    const changes: PlanChange[] = [
      { op: 'add', workout: { date: '2026-10-28', sport: 'swim', title: ' Nado ', durationMin: 40, intensity: 'endurance' }, reason: 'r' },
      { op: 'move', workoutId: 'p', toDate: '2026-10-29', reason: 'r' },
      { op: 'update', workoutId: 'p', patch: { durationMin: 30, source: 'rules', title: ' Corto ' }, reason: 'r' },
      { op: 'delete', workoutId: 'id-1', reason: 'r' },
    ];
    const r = applyPlanChanges(input, changes, ctx());
    expect(r.applied).toBe(4);
    expect(r.failed).toEqual([]);
    const moved = r.workouts.find((w) => w.id === 'p');
    expect(moved).toEqual(expect.objectContaining({ date: '2026-10-29', startTime: '07:00', durationMin: 30, title: 'Corto', source: 'rules' }));
    expect(r.workouts.some((w) => w.id === 'id-1')).toBe(false);
    expect(input[0]?.date).toBe('2026-10-27');
  });

  test('failures are reported per change and do not abort', () => {
    const changes: PlanChange[] = [
      { op: 'delete', workoutId: 'missing', reason: 'r' },
      { op: 'move', workoutId: 'd', toDate: '2026-10-29', reason: 'r' },
      { op: 'move', workoutId: 'p', toDate: 'bad', reason: 'r' },
      { op: 'update', workoutId: 'p', patch: { durationMin: 9999 }, reason: 'r' },
      { op: 'add', workout: { date: '2026-10-28', sport: 'run', title: '', durationMin: 10, intensity: 'endurance' }, reason: 'r' },
      { op: 'move', workoutId: 'p', toDate: '2026-10-30', toStartTime: null, reason: 'r' },
    ];
    const r = applyPlanChanges([planned, done], changes, ctx());
    expect(r.applied).toBe(1);
    expect(r.failed.map((f) => f.index)).toEqual([0, 1, 2, 3, 4]);
    expect(r.failed[1]?.error).toMatch(/completado/);
    expect(r.workouts.find((w) => w.id === 'p')?.startTime).toBeNull();
  });

  test('completed workouts can still be updated (e.g. notes)', () => {
    const r = applyPlanChanges([done], [{ op: 'update', workoutId: 'd', patch: { description: 'ok' }, reason: 'r' }], ctx());
    expect(r.applied).toBe(1);
  });
});

describe('describeChange', () => {
  const workouts = [makeWorkout({ id: 'p', title: 'Rodaje' })];
  test('Spanish labels for each op', () => {
    expect(describeChange({ op: 'add', workout: { date: '2026-10-28', sport: 'run', title: 'Series', durationMin: 40, intensity: 'threshold' }, reason: '' }, workouts)).toBe('Añadir «Series» el 2026-10-28');
    expect(describeChange({ op: 'delete', workoutId: 'p', reason: '' }, workouts)).toBe('Quitar «Rodaje»');
    expect(describeChange({ op: 'move', workoutId: 'p', toDate: '2026-10-29', toStartTime: '18:00', reason: '' }, workouts)).toBe('Mover «Rodaje» al 2026-10-29 a las 18:00');
    expect(describeChange({ op: 'update', workoutId: 'x', patch: {}, reason: '' }, workouts)).toBe('Ajustar «entreno»');
  });
});
