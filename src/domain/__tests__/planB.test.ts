import { notMyDayPatch } from '../planB';
import { buildSession } from '../sessions';
import type { Thresholds } from '../types';
import { makeWorkout } from './fixtures';

const T: Thresholds = { lthr: 170, maxHr: 190, runThresholdPaceSecPerKm: 270, ftpW: 250 };

function stepMinutes(steps: readonly { durationMin?: number; repeat?: number }[] = []): number {
  return steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

describe('notMyDayPatch ("No es mi día")', () => {
  test('a threshold run becomes ~65 % of it in Z2, with targets and coaching', () => {
    const steps = buildSession({ code: 'RN_THR', durationMin: 60, priority: 1 }).steps;
    const w = makeWorkout({ title: "Series umbral 3×8'", intensity: 'threshold', durationMin: 60, steps, isKey: true, distanceM: 10000 });
    const patch = notMyDayPatch(w, T);
    expect(patch).toEqual(
      expect.objectContaining({ sport: 'run', intensity: 'endurance', durationMin: 40, title: 'Versión suave: rodaje suave Z2', isKey: false, distanceM: null }),
    );
    expect(patch?.description).toMatch(/^En lugar de «Series umbral 3×8'»: /);
    expect(patch?.steps).toEqual([expect.objectContaining({ kind: 'work', durationMin: 40, intensity: 'endurance' })]);
    expect(patch?.coaching?.keys.join(' ')).toMatch(/145–151 ppm/);
    expect(patch?.tss).toBeGreaterThan(0);
  });

  test('bricks keep only the bike; easy sessions get the recovery version', () => {
    expect(notMyDayPatch(makeWorkout({ sport: 'brick', intensity: 'endurance', durationMin: 120 }), T)).toEqual(
      expect.objectContaining({ sport: 'bike', intensity: 'endurance', durationMin: 80, title: 'Versión suave: bici fondo Z2' }),
    );
    const easy = notMyDayPatch(makeWorkout({ durationMin: 45 }), T);
    expect(easy).toEqual(expect.objectContaining({ intensity: 'recovery', durationMin: 30, title: 'Versión suave: rodaje regenerativo' }));
    expect(stepMinutes(easy?.steps)).toBe(30);
    expect(notMyDayPatch(makeWorkout({ sport: 'strength', intensity: 'tempo', durationMin: 45 }), T)).toEqual(
      expect.objectContaining({ sport: 'mobility', intensity: 'recovery', title: 'Versión suave: movilidad' }),
    );
  });

  test('red days: recovery version capped at 45 minutes', () => {
    const long = makeWorkout({ sport: 'bike', intensity: 'endurance', durationMin: 180, isKey: true });
    expect(notMyDayPatch(long, T, { recovery: true, maxMin: 45 })).toEqual(
      expect.objectContaining({ sport: 'bike', intensity: 'recovery', durationMin: 45, title: 'Versión suave: bici suave de recuperación' }),
    );
  });

  test('no easier version for rest, done, skipped, race or already easy sessions', () => {
    expect(notMyDayPatch(makeWorkout({ sport: 'rest', durationMin: 0 }), T)).toBeNull();
    expect(notMyDayPatch(makeWorkout({ status: 'completed' }), T)).toBeNull();
    expect(notMyDayPatch(makeWorkout({ status: 'skipped' }), T)).toBeNull();
    expect(notMyDayPatch(makeWorkout({ sport: 'brick', intensity: 'race', durationMin: 330, isKey: true, title: 'Carrera: Valencia' }), T)).toBeNull();
    expect(notMyDayPatch(makeWorkout({ sport: 'mobility', intensity: 'recovery', durationMin: 10 }), T)).toBeNull();
    expect(notMyDayPatch(makeWorkout({ intensity: 'recovery', durationMin: 10 }), T)).toBeNull();
  });

  test('works without thresholds (zones and RPE only)', () => {
    const patch = notMyDayPatch(makeWorkout({ sport: 'bike', intensity: 'threshold', durationMin: 75 }), null);
    expect(patch?.title).toBe('Versión suave: bici fondo Z2');
    expect(patch?.coaching?.keys.join(' ')).not.toMatch(/ppm|W\b/);
  });
});
