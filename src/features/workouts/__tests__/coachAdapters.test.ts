import { describe, expect, test } from '@jest/globals';

import type { Thresholds, WorkoutStep } from '@/domain/types';

import { easierPatch, workoutVerdict } from '../coachAdapters';
import { makeWorkout } from './fixtures';

const STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15 },
  { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold' },
  { kind: 'recovery', durationMin: 2, repeat: 3 },
  { kind: 'cooldown', durationMin: 10 },
];
const THRESHOLDS: Thresholds = { lthr: 170, runThresholdPaceSecPerKm: 270 };
const COACHING = { objective: 'Subir tu umbral', keys: ['Series iguales'], success: 'La última serie como la primera', planB: null };
const series = makeWorkout({ title: 'Series 3×8', intensity: 'threshold', durationMin: 60, steps: STEPS, coaching: COACHING });

describe('easierPatch ("No es mi día")', () => {
  test('a planned hard session gets an easier version that never keeps the old coaching', () => {
    const patch = easierPatch(series, THRESHOLDS);
    expect(patch).not.toBeNull();
    expect(patch?.intensity).not.toBe('threshold');
    expect(patch).toHaveProperty('coaching');
    expect(patch?.coaching).not.toEqual(COACHING);
  });

  test('nothing to ease on rest days or sessions already done or skipped', () => {
    expect(easierPatch(makeWorkout({ sport: 'rest' }), THRESHOLDS)).toBeNull();
    expect(easierPatch({ ...series, status: 'completed' }, THRESHOLDS)).toBeNull();
    expect(easierPatch({ ...series, status: 'skipped' }, THRESHOLDS)).toBeNull();
  });
});

describe('workoutVerdict', () => {
  test("the coach's verdict for a completed session: title, detail and next step", () => {
    const done = makeWorkout({
      ...series,
      status: 'completed',
      completed: { durationMin: 60, avgHr: 150, rpe: 6, feel: 4, source: 'manual' },
    });
    const verdict = workoutVerdict(done, THRESHOLDS, null);
    expect(verdict?.title).toEqual(expect.any(String));
    expect(verdict?.title.length).toBeGreaterThan(0);
    expect(typeof verdict?.detail).toBe('string');
    expect(verdict?.next === null || typeof verdict?.next === 'string').toBe(true);
  });

  test('no verdict before the session is done', () => {
    expect(workoutVerdict(series, THRESHOLDS, null)).toBeNull();
    expect(workoutVerdict({ ...series, status: 'skipped' }, THRESHOLDS, null)).toBeNull();
  });
});
