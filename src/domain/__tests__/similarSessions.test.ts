import { addDays } from '../dates';
import { compareWithSimilar } from '../similarSessions';
import type { Workout } from '../types';
import { makeWorkout } from './fixtures';

const DAY = '2026-11-20';

/** A completed easy run of `km` in `min` at `hr`, `daysAgo` days before DAY. */
function run(id: string, daysAgo: number, km: number, min: number, hr?: number, overrides: Partial<Workout> = {}): Workout {
  return makeWorkout({
    id,
    date: addDays(DAY, -daysAgo),
    sport: 'run',
    intensity: 'endurance',
    durationMin: min,
    status: 'completed',
    completed: { durationMin: min, distanceM: km * 1000, ...(hr ? { avgHr: hr } : {}), source: 'garmin' },
    ...overrides,
  });
}

const history = [run('a', 3, 9, 54, 150), run('b', 7, 9, 55, 152), run('c', 10, 9.5, 57, 151), run('d', 14, 9, 56, 150)];

describe('compareWithSimilar', () => {
  test('easy run with HR: efficiency against the similar ones, with the rank', () => {
    const today = run('t', 0, 10, 55, 148);
    const c = compareWithSimilar(today, [...history, today]);
    expect(c).not.toBeNull();
    expect(c?.metric).toBe('efficiency');
    expect(c?.count).toBe(4);
    expect(c?.rank).toBe(1);
    expect(c?.deltaPct).toBeGreaterThanOrEqual(3);
    expect(c?.text).toMatch(/^Eficiencia un \d+ % mejor que la media de tus 4 carreras parecidas: más rápido al mismo pulso\.$/);
  });

  test('a small difference reads as "en tu línea"', () => {
    const today = run('t', 0, 9.1, 55, 151);
    expect(compareWithSimilar(today, history)?.text).toBe('Eficiencia en tu línea: igual que la media de tus 4 carreras parecidas.');
  });

  test('quality sessions and missing HR compare pace', () => {
    const series = history.map((w) => ({ ...w, intensity: 'threshold' as const }));
    const today = run('t', 0, 8, 55, 165, { intensity: 'threshold' });
    expect(compareWithSimilar(today, series)?.metric).toBe('speed');
    const noHr = run('t2', 0, 8, 55);
    const c = compareWithSimilar(noHr, history);
    expect(c?.metric).toBe('speed');
    expect(c?.text).toMatch(/^Ritmo un \d+ % peor/);
  });

  test('null with fewer than 3 similar sessions, without distance, or not completed', () => {
    expect(compareWithSimilar(run('t', 0, 10, 55, 148), history.slice(0, 2))).toBeNull();
    expect(compareWithSimilar(makeWorkout({ sport: 'run', status: 'completed', completed: { durationMin: 50 } }), history)).toBeNull();
    expect(compareWithSimilar({ ...run('t', 0, 10, 55, 148), status: 'planned' }, history)).toBeNull();
    expect(compareWithSimilar(run('t', 0, 10, 55, 148, { sport: 'strength' }), history)).toBeNull();
  });

  test('older than a year, other sports and the session itself are left out', () => {
    const old = [run('o1', 400, 9, 55, 150), run('o2', 401, 9, 55, 150), run('o3', 402, 9, 55, 150)];
    const rides = history.map((w) => ({ ...w, id: `r${w.id}`, sport: 'bike' as const }));
    const today = run('t', 0, 10, 55, 148);
    expect(compareWithSimilar(today, [...old, ...rides, today])).toBeNull();
  });
});
