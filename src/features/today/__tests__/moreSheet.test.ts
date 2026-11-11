import { describe, expect, jest, test } from '@jest/globals';

import type { WorkoutPatch } from '@/domain/types';

import { moreSheetConfig } from '../moreSheet';

describe('moreSheetConfig', () => {
  test('"No es mi día" first, with a short explanation, when there is an easier version', () => {
    const onEasier = jest.fn((_patch: WorkoutPatch) => undefined);
    const patch: WorkoutPatch = { durationMin: 30, intensity: 'recovery' };
    const config = moreSheetConfig({ title: 'Series' }, patch, { onEasier, onMove: jest.fn(), onSkip: jest.fn() });
    expect(config.title).toBe('Series');
    expect(config.message).toBe('Si hoy no te ves, cámbialo por una versión más suave.');
    expect(config.actions.map((a) => a.label)).toEqual(['No es mi día', 'Mover a otro día', 'Saltar']);
    config.actions[0]?.onPress();
    expect(onEasier).toHaveBeenCalledWith(patch);
  });

  test('only move and skip without an easier version', () => {
    const onSkip = jest.fn();
    const config = moreSheetConfig({ title: 'Rodaje' }, null, { onEasier: jest.fn(), onMove: jest.fn(), onSkip });
    expect(config).not.toHaveProperty('message');
    expect(config.actions.map((a) => a.label)).toEqual(['Mover a otro día', 'Saltar']);
    config.actions[1]?.onPress();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
