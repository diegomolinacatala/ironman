import { describe, expect, test } from '@jest/globals';

import type { CompletedData, Workout } from '../types';
import { enrichManualCompletion, isManualCompletion } from '../watchCompletion';

type Completion = Pick<Workout, 'status' | 'completed' | 'externalId'>;

const done = (completed: CompletedData | null, externalId: string | null = null): Completion => ({ status: 'completed', completed, externalId });

describe('isManualCompletion', () => {
  test('«Hecho» by hand, or logged by Claude without an activity id', () => {
    expect(isManualCompletion(done({ source: 'manual', durationMin: 50, rpe: 6 }))).toBe(true);
    expect(isManualCompletion(done({ durationMin: 50 }))).toBe(true);
    expect(isManualCompletion(done(null))).toBe(true);
    expect(isManualCompletion(done({ source: 'claude', durationMin: 40 }, 'claude:3f1c'))).toBe(true);
  });

  test('anything linked to an activity, imported from a watch or not completed is not', () => {
    expect(isManualCompletion(done({ source: 'healthkit', externalId: 'HK-1' }))).toBe(false);
    expect(isManualCompletion(done({ source: 'garmin', durationMin: 50 }))).toBe(false);
    expect(isManualCompletion(done({ source: 'claude', externalId: 'coros:77' }, 'coros:77'))).toBe(false);
    expect(isManualCompletion(done({ source: 'claude' }, 'garmin:123'))).toBe(false);
    expect(isManualCompletion({ status: 'planned', completed: null, externalId: null })).toBe(false);
    expect(isManualCompletion({ status: 'skipped', completed: { notes: 'Lluvia' }, externalId: null })).toBe(false);
  });
});

describe('enrichManualCompletion', () => {
  const manual: CompletedData = { source: 'manual', durationMin: 50, distanceM: 10000, rpe: 6, feel: 4, notes: 'Bien', completedAt: '2026-11-20T08:00:00.000Z' };
  const watch: CompletedData = {
    source: 'garmin',
    externalId: '9001',
    durationMin: 53,
    distanceM: 10340,
    avgHr: 148,
    maxHr: 171,
    tss: 61,
    kcal: 640,
    completedAt: '2026-11-20T10:00:00.000Z',
  };

  test('the watch brings its numbers, source and id; the athlete keeps RPE, feel, notes and time', () => {
    expect(enrichManualCompletion(manual, watch)).toEqual({
      source: 'garmin',
      externalId: '9001',
      durationMin: 53,
      distanceM: 10340,
      avgHr: 148,
      maxHr: 171,
      tss: 61,
      kcal: 640,
      rpe: 6,
      feel: 4,
      notes: 'Bien',
      completedAt: '2026-11-20T08:00:00.000Z',
    });
  });

  test("never overwrites what the athlete said, only fills what they left empty", () => {
    const fromClaude: CompletedData = { ...watch, source: 'claude', rpe: 9, feel: 1, notes: 'Dato de Claude' };
    expect(enrichManualCompletion(manual, fromClaude)).toMatchObject({ rpe: 6, feel: 4, notes: 'Bien' });
    expect(enrichManualCompletion({ source: 'manual', durationMin: 50 }, fromClaude)).toMatchObject({ rpe: 9, feel: 1, notes: 'Dato de Claude' });
  });

  test('keeps the hand-typed value when the watch does not have it', () => {
    const indoor: CompletedData = { source: 'healthkit', externalId: 'HK-9', durationMin: 47, avgHr: 139 };
    expect(enrichManualCompletion(manual, indoor)).toMatchObject({ distanceM: 10000, durationMin: 47, avgHr: 139 });
    expect(enrichManualCompletion(null, indoor)).toEqual(indoor);
  });
});
