import { describe, expect, jest, test } from '@jest/globals';

import type { WorkoutPatch } from '@/domain/types';

import { moreSheetConfig } from '../moreSheet';

describe('moreSheetConfig', () => {
  test('"Registrar como hecho", then "No es mi día" with a short explanation when there is an easier version', () => {
    const onEasier = jest.fn((_patch: WorkoutPatch) => undefined);
    const onComplete = jest.fn();
    const patch: WorkoutPatch = { durationMin: 30, intensity: 'recovery' };
    const config = moreSheetConfig({ title: 'Series' }, patch, { onComplete, onEasier, onMove: jest.fn(), onSkip: jest.fn() });
    expect(config.title).toBe('Series');
    expect(config.message).toBe('Si hoy no te ves, cámbialo por una versión más suave.');
    expect(config.actions.map((a) => a.label)).toEqual(['Registrar como hecho', 'No es mi día', 'Mover a otro día', 'Saltar']);
    config.actions[0]?.onPress();
    expect(onComplete).toHaveBeenCalledTimes(1);
    config.actions[1]?.onPress();
    expect(onEasier).toHaveBeenCalledWith(patch);
  });

  test('without an easier version: register as done, move or skip', () => {
    const onSkip = jest.fn();
    const config = moreSheetConfig({ title: 'Rodaje' }, null, { onComplete: jest.fn(), onEasier: jest.fn(), onMove: jest.fn(), onSkip });
    expect(config).not.toHaveProperty('message');
    expect(config.actions.map((a) => a.label)).toEqual(['Registrar como hecho', 'Mover a otro día', 'Saltar']);
    config.actions[2]?.onPress();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
