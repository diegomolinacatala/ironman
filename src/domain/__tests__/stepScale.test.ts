import { easyPatch, shortenedPatch } from '../replanCore';
import { buildSession } from '../sessions';
import { scaleSteps } from '../stepScale';
import type { WorkoutStep } from '../types';
import { makeWorkout } from './fixtures';

function minutes(steps: readonly WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

describe('scaleSteps', () => {
  test('interval sets lose repetitions and blocks shrink to fit the new duration', () => {
    const steps = buildSession({ code: 'RN_THR', durationMin: 60, priority: 1 }).steps;
    const scaled = scaleSteps(steps, 60, 40);
    expect(scaled.find((s) => s.kind === 'work')).toEqual(expect.objectContaining({ durationMin: 8, repeat: 2 }));
    expect(scaled.find((s) => s.kind === 'recovery')?.repeat).toBe(2);
    expect(minutes(scaled)).toBe(40);
    expect(scaled.find((s) => s.kind === 'work')?.cue).toBeTruthy();
  });

  test('never adds up to more than the new duration, for every catalog shape', () => {
    for (const code of ['BK_THR', 'BK_SST', 'RN_HILLS', 'RN_EASY', 'BK_LONG', 'BRICK', 'ST_HEAVY'] as const) {
      for (const from of [45, 60, 90, 150]) {
        const steps = buildSession({ code, durationMin: from, priority: 2, racePace: true }).steps;
        for (const to of [10, 20, 30, from - 5]) {
          expect(minutes(scaleSteps(steps, from, to))).toBeLessThanOrEqual(to + 1e-9);
        }
      }
    }
  });

  test('swim distances scale too; nothing to do when not shorter', () => {
    const swim = buildSession({ code: 'SW_END', durationMin: 60, priority: 4 }).steps;
    const scaled = scaleSteps(swim, 60, 30);
    expect(scaled[0]?.distanceM).toBe(150);
    expect(scaled[1]?.repeat).toBeLessThan(swim[1]?.repeat ?? 0);
    expect(scaleSteps(swim, 60, 60)).toEqual(swim);
    expect(scaleSteps([], 60, 30)).toEqual([]);
  });
});

describe('replanCore patches', () => {
  test('shortenedPatch scales the steps with the duration', () => {
    const steps = buildSession({ code: 'BK_THR', durationMin: 75, priority: 2 }).steps;
    const patch = shortenedPatch(makeWorkout({ sport: 'bike', intensity: 'threshold', durationMin: 75, steps }), 50);
    expect(patch.durationMin).toBe(50);
    expect(minutes(patch.steps ?? [])).toBeLessThanOrEqual(50);
    expect(shortenedPatch(makeWorkout({ durationMin: 60 }), 40)).not.toHaveProperty('steps');
  });

  test('easyPatch rebuilds the session with coaching and the athlete targets', () => {
    const w = makeWorkout({ intensity: 'threshold', durationMin: 60, distanceM: 12000 });
    const patch = easyPatch(w, { durationMin: 40 }, { thresholds: { lthr: 170 } });
    expect(patch).toEqual(expect.objectContaining({ sport: 'run', intensity: 'endurance', durationMin: 40, distanceM: null, title: 'Rodaje suave Z2' }));
    expect(patch.steps?.every((s) => s.intensity === 'endurance')).toBe(true);
    expect(patch.coaching?.keys.join(' ')).toMatch(/145–151 ppm/);
    expect(easyPatch(makeWorkout({ sport: 'strength' }), { durationMin: 30, intensity: 'recovery' }).sport).toBe('mobility');
    expect(easyPatch(makeWorkout({ sport: 'other' }), { durationMin: 30 })).toEqual(expect.objectContaining({ steps: [], coaching: null }));
  });
});
