import { describe, expect, test } from '@jest/globals';

import type { Thresholds, WorkoutStep } from '@/domain/types';

import { FEEL_OPTIONS, feelLabel } from '../feel';
import { a11ySentences } from '../format';
import {
  cardTargetCaption,
  completedSourceLabel,
  easierMessage,
  mainTargetTile,
  needsHrHint,
  planVsRealRows,
  stepTargetCaption,
} from '../targets';
import { makeWorkout } from './fixtures';

const STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15 },
  { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Fuerte pero controlado' },
  { kind: 'recovery', durationMin: 2, repeat: 3 },
  { kind: 'cooldown', durationMin: 10 },
];
const FULL: Thresholds = { lthr: 170, runThresholdPaceSecPerKm: 270 };
const series = makeWorkout({ title: 'Series', intensity: 'threshold', durationMin: 60, steps: STEPS });

describe('main target', () => {
  test('tile: heart rate first, then main set, pace and RPE', () => {
    expect(mainTargetTile(series, FULL)).toEqual({
      label: 'Zona objetivo',
      value: '162–168 ppm',
      hint: "3×8' Z4 · 4:27–4:44 /km · RPE 7–8",
      intensity: 'threshold',
    });
  });

  test('tile: estimated HR says "aprox."; no thresholds = effort (RPE)', () => {
    expect(mainTargetTile(series, { maxHr: 190 })?.value).toBe('162–168 ppm aprox.');
    expect(mainTargetTile(series, null)).toEqual({ label: 'Esfuerzo objetivo', value: 'RPE 7–8', hint: "3×8' Z4", intensity: 'threshold' });
  });

  test('tile: none for rest days; strength is effort only', () => {
    expect(mainTargetTile(makeWorkout({ sport: 'rest' }), FULL)).toBeNull();
    expect(mainTargetTile(makeWorkout({ sport: 'strength', durationMin: 40 }), FULL)).toMatchObject({
      label: 'Esfuerzo objetivo',
      value: 'RPE 6–7',
      hint: null,
    });
  });

  test('card caption: zone + main target', () => {
    expect(cardTargetCaption(series, { lthr: 170 })).toBe('Z4 · 162–168 ppm');
    expect(cardTargetCaption(series, null)).toBe('Z4 · RPE 7–8');
    expect(cardTargetCaption(makeWorkout({ sport: 'rest' }), FULL)).toBeNull();
  });

  test('step caption joins zone and targets', () => {
    expect(stepTargetCaption({ zone: 'Z2', targets: ['145–151 ppm', 'RPE 3–4'] })).toBe('Z2 · 145–151 ppm · RPE 3–4');
    expect(stepTargetCaption({ zone: '', targets: ['RPE 6–7'] })).toBe('RPE 6–7');
  });

  test('HR hint only for heart-rate sports without LTHR or max HR', () => {
    expect(needsHrHint({ sport: 'run' }, { runThresholdPaceSecPerKm: 270 })).toBe(true);
    expect(needsHrHint({ sport: 'brick' }, null)).toBe(true);
    expect(needsHrHint({ sport: 'bike' }, { maxHr: 190 })).toBe(false);
    expect(needsHrHint({ sport: 'swim' }, null)).toBe(false);
    expect(needsHrHint({ sport: 'strength' }, null)).toBe(false);
  });
});

describe('completed sessions', () => {
  const done = makeWorkout({
    ...series,
    status: 'completed',
    completed: { durationMin: 58, avgHr: 152.4, rpe: 7, feel: 4, source: 'healthkit', completedAt: '2026-10-25T10:00:00.000Z' },
  });

  test('plan vs real: duration, FC media vs the expected session average, RPE and sensaciones', () => {
    expect(planVsRealRows(done, { lthr: 170 })).toEqual([
      { label: 'Duración', plan: '1h', real: "58'" },
      { label: 'FC media', plan: '143–154 ppm', real: '152 ppm' },
      { label: 'RPE', plan: '7–8', real: '7 · Duro' },
      { label: 'Sensaciones', plan: '', real: 'Bien' },
    ]);
  });

  test('plan vs real: distance row when planned or done; FC plan empty without thresholds', () => {
    const run = makeWorkout({ status: 'completed', distanceM: 10000, completed: { durationMin: 50, distanceM: 10200, avgHr: 150 } });
    const rows = planVsRealRows(run, null);
    expect(rows.find((r) => r.label === 'Distancia')).toEqual({ label: 'Distancia', plan: '10 km', real: '10,2 km' });
    expect(rows.find((r) => r.label === 'FC media')).toEqual({ label: 'FC media', plan: '', real: '150 ppm' });
    expect(planVsRealRows(done, { maxHr: 190 }).find((r) => r.label === 'FC media')?.plan).toMatch(/^\d+–\d+ ppm aprox\.$/);
  });

  test('source label: the imported activity wins over the writer', () => {
    expect(completedSourceLabel(done)).toBe('Desde Apple Salud');
    expect(completedSourceLabel({ externalId: 'coros:123', completed: { source: 'claude' } })).toBe('Desde COROS');
    expect(completedSourceLabel({ externalId: null, completed: { source: 'claude', externalId: 'garmin:9' } })).toBe('Desde Garmin');
    expect(completedSourceLabel({ externalId: null, completed: { source: 'claude' } })).toBe('Desde Claude');
    expect(completedSourceLabel({ externalId: null, completed: { source: 'manual' } })).toBe('Registrado a mano');
    expect(completedSourceLabel({ externalId: null, completed: null })).toBeNull();
  });
});

describe('"No es mi día" confirm text', () => {
  const patch = { title: 'Rodaje suave', durationMin: 40, intensity: 'endurance' as const, steps: [] };

  test("the coach's plan B first, then what the session becomes", () => {
    const coached = { ...series, coaching: { objective: 'o', keys: [], success: 's', planB: "Rodaje suave de 40'" } };
    expect(easierMessage(coached, patch)).toBe("Rodaje suave de 40'\n\nQuedará así: Rodaje suave · 40' · Fondo Z2.");
  });

  test('without plan B, only the result; turning it into rest says so', () => {
    expect(easierMessage(series, patch)).toBe("Quedará así: Rodaje suave · 40' · Fondo Z2.");
    expect(easierMessage(series, { sport: 'rest' })).toBe('Quedará como descanso.');
  });
});

describe('sensaciones and a11y text', () => {
  test('feel labels 1–5', () => {
    expect(FEEL_OPTIONS.map((o) => o.label)).toEqual(['Muy mal', 'Mal', 'Normal', 'Bien', 'Genial']);
    expect(feelLabel(5)).toBe('Genial');
    expect(feelLabel(0)).toBe('');
  });

  test('a11ySentences ends each sentence once and drops empty ones', () => {
    expect(a11ySentences(['Tu coach', ' Bien hecho. ', '', null, '¿Repetimos?'])).toBe('Tu coach. Bien hecho. ¿Repetimos?');
  });
});
