import { describe, expect, test } from '@jest/globals';

import { applyThresholdSuggestion, formatPaceSec, thresholdSuggestions } from '../thresholdSuggestions';
import type { CompletedData, Workout } from '../types';
import { makeWorkout } from './fixtures';

const TODAY = '2026-11-26';

let n = 0;
function done(date: string, sport: Workout['sport'], completed: CompletedData, extra: Partial<Workout> = {}): Workout {
  n += 1;
  return makeWorkout({ id: `w${n}`, date, sport, status: 'completed', completed, ...extra });
}

/** A 10 km run in `min` minutes at `avgHr`. */
const run = (date: string, min: number, avgHr: number, distanceM = 10000, maxHr?: number) =>
  done(date, 'run', { durationMin: min, distanceM, avgHr, ...(maxHr ? { maxHr } : {}) });

describe('thresholdSuggestions: run threshold pace', () => {
  const t = { runThresholdPaceSecPerKm: 280, lthr: 170, maxHr: 188 };

  test('a hard 10 km in 44:10 at threshold HR suggests a faster pace, with the evidence', () => {
    const [s] = thresholdSuggestions(t, [run('2026-11-12', 44.17, 168)], TODAY);
    expect(s?.field).toBe('runThresholdPaceSecPerKm');
    // 265 s/km over 44' → ≈ 270 s/km for one hour (Riegel).
    expect(s?.suggested).toBe(270);
    expect(s?.message).toBe('Tu umbral de carrera parece haber mejorado a 4:30/km (antes 4:40). ¿Lo actualizo?');
    expect(s?.evidence).toBe('Por tu carrera del 12 nov: 10,0 km a 4:25/km con 168 ppm de media.');
  });

  test('less than 3 % faster, an easy run, too short or too long, or older than 8 weeks: nothing', () => {
    expect(thresholdSuggestions(t, [run('2026-11-12', 46.5, 168)], TODAY)).toEqual([]);
    expect(thresholdSuggestions(t, [run('2026-11-12', 44, 150)], TODAY)).toEqual([]);
    expect(thresholdSuggestions(t, [run('2026-11-12', 15, 175, 3600)], TODAY)).toEqual([]);
    expect(thresholdSuggestions(t, [run('2026-11-12', 75, 165, 17000)], TODAY)).toEqual([]);
    expect(thresholdSuggestions(t, [run('2026-09-20', 44, 168)], TODAY)).toEqual([]);
    expect(thresholdSuggestions(t, [{ ...run('2026-11-12', 44, 168), status: 'planned' }], TODAY)).toEqual([]);
  });

  test('a slower hard run never suggests a worse threshold', () => {
    expect(thresholdSuggestions(t, [run('2026-11-12', 52, 168)], TODAY)).toEqual([]);
  });

  test('without LTHR, 85 % of max HR marks the hard run; with no pace yet it offers to save one', () => {
    const [s] = thresholdSuggestions({ maxHr: 190 }, [run('2026-11-12', 44.17, 163)], TODAY);
    expect(s?.current).toBeNull();
    expect(s?.message).toBe('Tu umbral de carrera parece estar en 4:30/km. ¿Lo guardo?');
    expect(thresholdSuggestions({ maxHr: 190 }, [run('2026-11-12', 44.17, 155)], TODAY)).toEqual([]);
    expect(thresholdSuggestions({}, [run('2026-11-12', 44.17, 175)], TODAY)).toEqual([]);
  });

  test('«Ahora no» hides it for 3 weeks', () => {
    const workouts = [run('2026-11-12', 44.17, 168)];
    expect(thresholdSuggestions(t, workouts, TODAY, { runThresholdPaceSecPerKm: '2026-11-10' })).toEqual([]);
    expect(thresholdSuggestions(t, workouts, TODAY, { runThresholdPaceSecPerKm: '2026-11-05' })).toHaveLength(1);
  });
});

describe('thresholdSuggestions: max HR', () => {
  test('needs two sessions at the new max, at least 3 bpm above the current one', () => {
    const peaks = [run('2026-11-01', 70, 140, 12000, 194), run('2026-11-15', 70, 140, 12000, 193)];
    const [s] = thresholdSuggestions({ maxHr: 188 }, peaks, TODAY);
    expect(s).toMatchObject({ field: 'maxHr', current: 188, suggested: 193 });
    expect(s?.message).toBe('Tu FC máxima parece ser 193 ppm (antes 188). ¿La actualizo?');
    expect(s?.evidence).toContain('la última el 15 nov');
    // One spike is not enough; +2 is not enough.
    expect(thresholdSuggestions({ maxHr: 188 }, [run('2026-11-01', 70, 140, 12000, 205)], TODAY)).toEqual([]);
    expect(thresholdSuggestions({ maxHr: 191 }, peaks, TODAY)).toEqual([]);
    expect(thresholdSuggestions({}, peaks, TODAY)).toEqual([]);
  });
});

describe('thresholdSuggestions: bike FTP', () => {
  const ride = (title: string, best20: number) => done('2026-11-20', 'bike', { durationMin: 60, bestPower20MinW: best20 }, { title });

  test('only from a recognisable test, 95 % of the best 20 minutes, up or down', () => {
    expect(thresholdSuggestions({ ftpW: 230 }, [ride('Test FTP 20 minutos', 263)], TODAY)[0]).toMatchObject({
      field: 'ftpW',
      suggested: 250,
      message: 'Tu test de bici da un FTP de 250 W (antes 230). ¿Lo actualizo?',
    });
    expect(thresholdSuggestions({ ftpW: 260 }, [ride('Test de 20 minutos', 253)], TODAY)[0]?.suggested).toBe(240);
    expect(thresholdSuggestions({ ftpW: 230 }, [ride('Rodaje con cambios de ritmo', 263)], TODAY)).toEqual([]);
    expect(thresholdSuggestions({ ftpW: 245 }, [ride('Test FTP', 263)], TODAY)).toEqual([]);
  });
});

test('applyThresholdSuggestion changes only that field; formatPaceSec', () => {
  expect(applyThresholdSuggestion({ ftpW: 230, lthr: 170 }, { field: 'ftpW', suggested: 250 })).toEqual({ ftpW: 250, lthr: 170 });
  expect(applyThresholdSuggestion(null, { field: 'maxHr', suggested: 192 })).toEqual({ maxHr: 192 });
  expect(formatPaceSec(272)).toBe('4:32');
});
