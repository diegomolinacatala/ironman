import type { Thresholds, WorkoutStep } from '../types';
import {
  athleteZones,
  formatHrRange,
  formatPaceRange,
  formatPowerRange,
  formatRpe,
  formatStepMinutes,
  mainSet,
  mainTargets,
  sessionHrRange,
  sessionRpe,
  stepTargets,
  targetParts,
  thresholdHr,
  zoneSportOf,
  zoneTargets,
} from '../zones';

const FULL: Thresholds = { lthr: 170, maxHr: 190, ftpW: 250, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 100 };

const INTERVALS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 10, intensity: 'recovery' },
  { kind: 'work', durationMin: 8, intensity: 'threshold', repeat: 3 },
  { kind: 'recovery', durationMin: 3, intensity: 'recovery', repeat: 3 },
  { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
];

describe('thresholdHr', () => {
  test('measured LTHR is the running one; the bike one is ~3 % lower', () => {
    expect(thresholdHr('run', FULL)).toEqual({ bpm: 170, estimated: false });
    expect(thresholdHr('bike', FULL)).toEqual({ bpm: 165, estimated: false });
  });

  test('estimated from max HR when there is no LTHR', () => {
    expect(thresholdHr('run', { maxHr: 190 })).toEqual({ bpm: 170, estimated: true });
    expect(thresholdHr('bike', { maxHr: 190 })).toEqual({ bpm: 165, estimated: true });
  });

  test('nothing usable → null (absurd values are ignored)', () => {
    expect(thresholdHr('run', {})).toBeNull();
    expect(thresholdHr('run', { lthr: 20 })).toBeNull();
    expect(thresholdHr('run', null)).toBeNull();
  });
});

describe('zoneTargets', () => {
  test('run Z2: ppm from LTHR, pace from threshold pace, RPE and talk test', () => {
    const z = zoneTargets('run', 'endurance', FULL);
    expect(z.hr).toEqual({ min: 145, max: 151 });
    expect(z.pace).toEqual({ min: 308, max: 348 });
    expect(z.power).toBeNull();
    expect(z.rpe).toEqual({ min: 3, max: 4 });
    expect(z.feel).toMatch(/frases completas/);
    expect(z.hrEstimated).toBe(false);
  });

  test('bike Z2: watts from FTP and the bike threshold HR', () => {
    const z = zoneTargets('bike', 'endurance', FULL);
    expect(z.power).toEqual({ min: 140, max: 185 });
    expect(z.hr).toEqual({ min: 134, max: 147 });
    expect(z.pace).toBeNull();
  });

  test('swim: CSS offsets, never heart rate', () => {
    const z = zoneTargets('swim', 'endurance', FULL);
    expect(z.pace).toEqual({ min: 108, max: 115 });
    expect(z.hr).toBeNull();
    expect(zoneTargets('swim', 'vo2', FULL).pace).toEqual({ min: 94, max: 96 });
  });

  test('threshold run', () => {
    const z = zoneTargets('run', 'threshold', FULL);
    expect(z.hr).toEqual({ min: 162, max: 168 });
    expect(z.pace).toEqual({ min: 267, max: 284 });
    expect(z.rpe).toEqual({ min: 7, max: 8 });
  });

  test('race pace depends on the race distance', () => {
    const half = zoneTargets('run', 'race', FULL, { raceDistance: 'half' });
    const full = zoneTargets('run', 'race', FULL, { raceDistance: 'full' });
    expect(half.hr).toEqual({ min: 156, max: 163 });
    expect(half.pace).toEqual({ min: 278, max: 294 });
    expect(full.hr!.max).toBeLessThan(half.hr!.max);
    expect(zoneTargets('bike', 'race', FULL, { raceDistance: 'full' }).power).toEqual({ min: 165, max: 195 });
    expect(zoneTargets('bike', 'race', FULL, { raceDistance: 'sprint' }).rpe).toEqual({ min: 8, max: 9 });
    // Unknown distance: middle distance numbers.
    expect(zoneTargets('run', 'race', FULL).hr).toEqual(half.hr);
  });

  test('max HR caps the top of the range', () => {
    const z = zoneTargets('run', 'vo2', { lthr: 170, maxHr: 175 });
    expect(z.hr).toEqual({ min: 170, max: 175 });
  });

  test('without thresholds only RPE and sensations remain', () => {
    const z = zoneTargets('run', 'tempo', {});
    expect(z.hr).toBeNull();
    expect(z.pace).toBeNull();
    expect(z.rpe).toEqual({ min: 5, max: 6 });
    expect(z.feel).toMatch(/frases cortas/);
  });

  test('estimated HR is flagged', () => {
    expect(zoneTargets('run', 'endurance', { maxHr: 190 }).hrEstimated).toBe(true);
  });

  test('strength, mobility and other sports', () => {
    expect(zoneTargets('strength', 'tempo', FULL).rpe).toEqual({ min: 6, max: 7 });
    expect(zoneTargets('mobility', 'recovery', FULL).feel).toMatch(/Sin dolor/);
    const other = zoneTargets('other', 'endurance', FULL);
    expect(other.hr).toBeNull();
    expect(other.rpe).toEqual({ min: 3, max: 4 });
  });

  test('brick legs', () => {
    expect(zoneSportOf('brick')).toBe('bike');
    expect(zoneSportOf('brick', 'run')).toBe('run');
    expect(zoneTargets('brick', 'endurance', FULL, { leg: 'run' }).pace).toEqual({ min: 308, max: 348 });
  });
});

describe('stepTargets', () => {
  const workout = { sport: 'run' as const, intensity: 'threshold' as const };

  test('a work step without intensity takes the session intensity; others are easy', () => {
    expect(stepTargets({ kind: 'work', durationMin: 8 }, workout, FULL).hr).toEqual({ min: 162, max: 168 });
    expect(stepTargets({ kind: 'warmup', durationMin: 10 }, workout, FULL).rpe).toEqual({ min: 1, max: 2 });
  });

  test('explicit targets win (and are not flagged as estimated)', () => {
    const step: WorkoutStep = { kind: 'work', durationMin: 20, intensity: 'threshold', target: { hr: { min: 150, max: 155 }, rpe: { min: 7, max: 7 } } };
    const z = stepTargets(step, workout, { maxHr: 190 });
    expect(z.hr).toEqual({ min: 150, max: 155 });
    expect(z.rpe).toEqual({ min: 7, max: 7 });
    expect(z.hrEstimated).toBe(false);
  });

  test('invalid explicit values are ignored', () => {
    const step: WorkoutStep = { kind: 'work', durationMin: 20, target: { hr: { min: 10, max: 400 } } };
    expect(stepTargets(step, workout, FULL).hr).toEqual({ min: 162, max: 168 });
  });

  test('the brick leg of the step decides the zones', () => {
    const brick = { sport: 'brick' as const, intensity: 'endurance' as const };
    expect(stepTargets({ kind: 'work', durationMin: 20, leg: 'run' }, brick, FULL).pace).toEqual({ min: 308, max: 348 });
    expect(stepTargets({ kind: 'work', durationMin: 60, leg: 'bike' }, brick, FULL).power).toEqual({ min: 140, max: 185 });
  });
});

describe('mainSet / mainTargets', () => {
  test('the hardest work block with its repetitions', () => {
    const set = mainSet(INTERVALS, 'threshold');
    expect(set?.label).toBe("3×8'");
    expect(set?.intensity).toBe('threshold');
  });

  test('strides after an easy run are an add-on, not the main set; no ppm for 30" efforts', () => {
    const easyPlusStrides: WorkoutStep[] = [
      { kind: 'work', durationMin: 24, intensity: 'endurance' },
      { kind: 'work', durationMin: 0.5, repeat: 6, intensity: 'vo2', target: { rpe: { min: 7, max: 8 } } },
      { kind: 'recovery', durationMin: 0.5, repeat: 6, intensity: 'recovery' },
    ];
    expect(mainSet(easyPlusStrides, 'endurance')?.label).toBe("24'");
    const strides = stepTargets(easyPlusStrides[1]!, { sport: 'run', intensity: 'endurance' }, FULL);
    expect(strides.hr).toBeNull();
    expect(strides.pace).not.toBeNull();
    expect(strides.rpe).toEqual({ min: 7, max: 8 });
  });

  test('steady session and distance sets', () => {
    expect(mainSet([{ kind: 'work', durationMin: 40, intensity: 'endurance' }], 'endurance')?.label).toBe("40'");
    expect(mainSet([{ kind: 'work', distanceM: 100, repeat: 10, intensity: 'threshold' }], 'threshold')?.label).toBe('10×100 m');
    expect(mainSet([{ kind: 'warmup', durationMin: 10 }], 'endurance')).toBeNull();
  });

  test('targets of the main set, or of the session intensity without steps', () => {
    expect(mainTargets({ sport: 'run', intensity: 'threshold', steps: INTERVALS }, FULL).targets.hr).toEqual({ min: 162, max: 168 });
    const noSteps = mainTargets({ sport: 'bike', intensity: 'endurance', steps: [] }, FULL);
    expect(noSteps.set).toBeNull();
    expect(noSteps.targets.power).toEqual({ min: 140, max: 185 });
  });
});

describe('session expectations', () => {
  test('average HR of the whole session is weighted by time', () => {
    expect(sessionHrRange({ sport: 'run', intensity: 'threshold', steps: INTERVALS }, FULL)).toEqual({ min: 143, max: 154 });
  });

  test('falls back to the session zone, and to null without HR data', () => {
    expect(sessionHrRange({ sport: 'run', intensity: 'endurance', steps: [] }, FULL)).toEqual({ min: 145, max: 151 });
    expect(sessionHrRange({ sport: 'swim', intensity: 'endurance', steps: [] }, FULL)).toBeNull();
    expect(sessionHrRange({ sport: 'run', intensity: 'endurance', steps: [] }, {})).toBeNull();
  });

  test('session RPE', () => {
    expect(sessionRpe({ sport: 'run', intensity: 'threshold', steps: INTERVALS })).toEqual({ min: 7, max: 8 });
    expect(sessionRpe({ sport: 'run', intensity: 'endurance', steps: [{ kind: 'warmup', durationMin: 10 }, { kind: 'work', durationMin: 40, intensity: 'endurance' }, { kind: 'cooldown', durationMin: 10 }] })).toEqual({ min: 3, max: 4 });
    expect(sessionRpe({ sport: 'run', intensity: 'endurance', steps: [] })).toEqual({ min: 3, max: 4 });
  });
});

describe('formatting', () => {
  test('ranges and single values', () => {
    expect(formatHrRange({ min: 145, max: 151 })).toBe('145–151 ppm');
    expect(formatHrRange({ min: 160, max: 160 })).toBe('160 ppm');
    expect(formatPaceRange({ min: 308, max: 348 }, 'run')).toBe('5:08–5:48 /km');
    expect(formatPaceRange({ min: 108, max: 115 }, 'swim')).toBe('1:48–1:55 /100 m');
    expect(formatPowerRange({ min: 140, max: 185 })).toBe('140–185 W');
    expect(formatRpe({ min: 9, max: 9 })).toBe('RPE 9');
  });

  test('step minutes with seconds', () => {
    expect(formatStepMinutes(0.5)).toBe('30"');
    expect(formatStepMinutes(1.5)).toBe("1' 30\"");
    expect(formatStepMinutes(75)).toBe("1h 15'");
    expect(formatStepMinutes(60)).toBe('1h');
    expect(formatStepMinutes(0)).toBe('');
  });

  test('targets in the order a coach says them', () => {
    expect(targetParts(zoneTargets('run', 'endurance', FULL), 'run')).toEqual(['145–151 ppm', '5:08–5:48 /km', 'RPE 3–4']);
    expect(targetParts(zoneTargets('bike', 'endurance', FULL), 'bike')).toEqual(['140–185 W', '134–147 ppm', 'RPE 3–4']);
    expect(targetParts(zoneTargets('swim', 'endurance', FULL), 'swim')).toEqual(['1:48–1:55 /100 m', 'RPE 3–4']);
    expect(targetParts(zoneTargets('run', 'endurance', {}), 'run')).toEqual(['RPE 3–4']);
  });
});

describe('athleteZones', () => {
  test('full table with the race row', () => {
    const z = athleteZones(FULL, { raceDistance: 'olympic' });
    expect(z.run.map((r) => r.zone)).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Carrera']);
    expect(z.run[1]!.hr).toEqual({ min: 145, max: 151 });
    expect(z.bike[3]!.power).toEqual({ min: 225, max: 260 });
    expect(z.swim[3]!.pace).toEqual({ min: 99, max: 103 });
    expect(z.lthr).toEqual({ run: 170, bike: 165, estimated: false });
    expect(z.missing).toEqual([]);
  });

  test('lists what is missing', () => {
    expect(athleteZones({}).missing).toEqual(['FC umbral o FC máxima', 'ritmo umbral de carrera', 'FTP', 'CSS de natación']);
    expect(athleteZones({ maxHr: 190 }).lthr.estimated).toBe(true);
  });
});
