import { applyPlanChanges, describeChange, validateCoaching, validateDraft } from '../changes';
import type { PlanChange, WorkoutCoaching, WorkoutStep } from '../types';
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

describe('coaching and steps (v4, same limits and messages as the server)', () => {
  const coaching: WorkoutCoaching = {
    objective: 'Subir el umbral sin pasarte',
    keys: ['Cadencia 85–95', 'Sin cambios de ritmo'],
    success: 'Las 3 series dentro de 220–235 W',
    planB: "60' en Z2",
  };

  test('validateCoaching accepts absent, null and valid coaching', () => {
    expect(validateCoaching(undefined)).toBeNull();
    expect(validateCoaching(null)).toBeNull();
    expect(validateCoaching(coaching)).toBeNull();
    expect(validateCoaching({ objective: 'x', success: 'y' })).toBeNull();
  });

  test.each([
    ['not an object', 'Rodaje suave', 'Indicaciones del entreno no válidas'],
    ['an array', [coaching], 'Indicaciones del entreno no válidas'],
    ['no objective', { ...coaching, objective: '   ' }, 'Objetivo del entreno no válido (1–200 caracteres)'],
    ['a long objective', { ...coaching, objective: 'x'.repeat(201) }, 'Objetivo del entreno no válido (1–200 caracteres)'],
    ['five keys', { ...coaching, keys: ['a', 'b', 'c', 'd', 'e'] }, 'Máximo 4 claves por entreno'],
    ['an empty key', { ...coaching, keys: ['a', ' '] }, 'Claves del entreno no válidas (1–160 caracteres cada una)'],
    ['a long key', { ...coaching, keys: ['k'.repeat(161)] }, 'Claves del entreno no válidas (1–160 caracteres cada una)'],
    ['keys as text', { ...coaching, keys: 'cadencia alta' }, 'Claves del entreno no válidas (1–160 caracteres cada una)'],
    ['no success criterion', { ...coaching, success: '' }, 'Criterio de éxito no válido (1–200 caracteres)'],
    ['an empty plan B', { ...coaching, planB: '  ' }, 'Plan B no válido (1–200 caracteres)'],
    ['a long plan B', { ...coaching, planB: 'p'.repeat(201) }, 'Plan B no válido (1–200 caracteres)'],
    ['too many bytes', { objective: '🚴'.repeat(200), keys: Array.from({ length: 4 }, () => '🏃'.repeat(160)), success: '🏊'.repeat(200), planB: '💤'.repeat(200) }, 'Indicaciones del entreno demasiado largas'],
  ])('validateCoaching rejects %s', (_label, value, message) => {
    expect(validateCoaching(value)).toBe(message);
  });

  test('validateDraft checks coaching and at most 50 steps', () => {
    const base = { date: '2026-10-27', title: 'Series', durationMin: 50 };
    const steps: WorkoutStep[] = Array.from({ length: 51 }, () => ({ kind: 'work', durationMin: 1 }));
    expect(validateDraft({ ...base, steps }, false)).toBe('Demasiados pasos (máximo 50)');
    expect(validateDraft({ ...base, steps: steps.slice(0, 50), coaching }, false)).toBeNull();
    expect(validateDraft({ coaching: { ...coaching, success: '' } }, true)).toBe('Criterio de éxito no válido (1–200 caracteres)');
    expect(validateDraft({ coaching: null }, true)).toBeNull();
  });

  test('added sessions keep their coaching (stored trimmed) and step targets; updates replace or clear it', () => {
    const step: WorkoutStep = { kind: 'work', durationMin: 10, repeat: 3, intensity: 'threshold', leg: 'bike', target: { power: { min: 220, max: 235 } }, cue: 'Cadencia alta' };
    const added = applyPlanChanges(
      [],
      [{ op: 'add', workout: { date: '2026-10-28', sport: 'brick', title: 'Transición', durationMin: 90, intensity: 'threshold', steps: [step], coaching: { ...coaching, objective: '  Umbral  ', planB: null } }, reason: 'r' }],
      ctx(),
    ).workouts[0];
    expect(added?.coaching).toEqual({ ...coaching, objective: 'Umbral', planB: null });
    expect(added?.steps).toEqual([step]);

    const withCoaching = makeWorkout({ id: 'c', coaching });
    const replaced = applyPlanChanges([withCoaching], [{ op: 'update', workoutId: 'c', patch: { coaching: { ...coaching, success: ' Hecho ' } }, reason: 'r' }], ctx());
    expect(replaced.workouts[0]?.coaching?.success).toBe('Hecho');
    const kept = applyPlanChanges([withCoaching], [{ op: 'update', workoutId: 'c', patch: { title: 'Otro' }, reason: 'r' }], ctx());
    expect(kept.workouts[0]?.coaching).toEqual(coaching);
    const cleared = applyPlanChanges([withCoaching], [{ op: 'update', workoutId: 'c', patch: { coaching: null }, reason: 'r' }], ctx());
    expect(cleared.workouts[0]).not.toHaveProperty('coaching');
    const invalid = applyPlanChanges([withCoaching], [{ op: 'update', workoutId: 'c', patch: { coaching: { ...coaching, keys: ['a', 'b', 'c', 'd', 'e'] } }, reason: 'r' }], ctx());
    expect(invalid.failed).toEqual([{ index: 0, error: 'Máximo 4 claves por entreno' }]);
  });
});
