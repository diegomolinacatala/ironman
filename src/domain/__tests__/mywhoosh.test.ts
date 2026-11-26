import { describe, expect, test } from '@jest/globals';

import {
  bikeShape,
  FREE_RIDE_MIN,
  MYWHOOSH_CATALOG,
  myWhooshA11y,
  myWhooshFor,
  myWhooshText,
  type WhooshContext,
} from '../mywhoosh';
import { specToDraft } from '../sessions';
import type { SessionCode } from '../sessionKit';
import type { Intensity, Workout, WorkoutStep } from '../types';
import { makeWorkout } from './fixtures';

/** A bike session from the app's own library (what the planner writes). */
function library(code: SessionCode, durationMin: number, ctx: WhooshContext = {}, extra: { racePace?: boolean } = {}): Workout {
  const draft = specToDraft({ code, durationMin, priority: 3, ...extra }, '2026-11-30', null, ctx);
  return makeWorkout({ ...draft, coaching: draft.coaching ?? null, id: `${code}-${durationMin}` });
}

/** Warm-up, `reps` × `repMin` at `intensity` with easy recoveries, cool-down. */
function intervals(intensity: Intensity, reps: number, repMin: number, extra: Partial<WorkoutStep> = {}): WorkoutStep[] {
  return [
    { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
    { kind: 'work', durationMin: repMin, intensity, repeat: reps, ...extra },
    { kind: 'recovery', durationMin: 3, intensity: 'recovery', repeat: reps },
    { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
  ];
}

function bike(intensity: Intensity, durationMin: number, steps: WorkoutStep[] = [], title = 'Bici'): Workout {
  return makeWorkout({ sport: 'bike', intensity, durationMin, steps, title });
}

function pickName(w: Workout, ctx: WhooshContext = {}): string | null {
  const pick = myWhooshFor(w, ctx);
  return pick ? `${pick.workout.folder} › ${pick.workout.name}` : null;
}

describe('MyWhoosh catalog', () => {
  test('every entry has a folder, a name, minutes and a main-set shape', () => {
    const all = Object.values(MYWHOOSH_CATALOG).flat();
    expect(all.length).toBeGreaterThan(15);
    for (const o of all) {
      expect(o.folder.length).toBeGreaterThan(0);
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.minutes).toBeGreaterThan(0);
      expect(o.reps).toBeGreaterThan(0);
      expect(o.repMin).toBeGreaterThan(0);
      expect(o.mainSet).toMatch(/%/);
    }
  });

  test('a name repeats only across folders (the folder tells them apart)', () => {
    const keys = Object.values(MYWHOOSH_CATALOG)
      .flat()
      .map((o) => `${o.folder}/${o.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('myWhooshFor', () => {
  test('only bike sessions with minutes', () => {
    expect(myWhooshFor(makeWorkout({ sport: 'run', intensity: 'threshold' }))).toBeNull();
    expect(myWhooshFor(makeWorkout({ sport: 'brick' }))).toBeNull();
    expect(myWhooshFor(bike('endurance', 0))).toBeNull();
  });

  test('VO2 with 3-minute reps: 6×3 → «VO2max 3min #1», 3×3 → «VO2max #3»', () => {
    expect(pickName(bike('vo2', 70, intervals('vo2', 6, 3)))).toBe('VO2max › VO2max 3min #1');
    expect(pickName(bike('vo2', 45, intervals('vo2', 3, 3)))).toBe('VO2max › VO2max #3');
  });

  test('VO2 with 4- (or 5-) minute reps → «VO2max 4min #1»', () => {
    expect(pickName(bike('vo2', 60, intervals('vo2', 4, 4)))).toBe('VO2max › VO2max 4min #1');
    expect(pickName(bike('vo2', 75, intervals('vo2', 5, 5)))).toBe('VO2max › VO2max 4min #1');
    // The app's own 60' VO2 session is 4×4'.
    expect(pickName(library('BK_VO2', 60))).toBe('VO2max › VO2max 4min #1');
  });

  test('a short VO2 session goes to «Under 35 min»', () => {
    expect(pickName(bike('vo2', 32, intervals('vo2', 2, 3)))).toBe('Under 35 min › V02max x 3min');
  });

  test('threshold: 2×20 → «Threshold 20», 2×15 → «Threshold 15», 5×5 → «Threshold #1»', () => {
    expect(pickName(bike('threshold', 70, intervals('threshold', 2, 20)))).toBe('Threshold › Threshold 20');
    expect(pickName(bike('threshold', 65, intervals('threshold', 2, 15)))).toBe('Threshold › Threshold 15');
    expect(pickName(bike('threshold', 60, intervals('threshold', 5, 5)))).toBe('Threshold › Threshold #1');
    // The app's own 60' threshold session (3×8') is closest to 5×5'.
    expect(pickName(library('BK_THR', 60))).toBe('Threshold › Threshold #1');
  });

  test('a short threshold session goes to «Threshold #1» in «Under 35 min»', () => {
    expect(pickName(library('BK_THR', 30))).toBe('Under 35 min › Threshold #1');
    expect(pickName(bike('threshold', 30, intervals('threshold', 3, 5)))).toBe('Under 35 min › Threshold #1');
  });

  test('sweet spot: 3×8–10 → «Sweetspot #1», 2×15 → «Sweet Spot 15», one 20\' block → «Sweetspot 20 minute»', () => {
    const titled = (reps: number, repMin: number, minutes: number) =>
      bike('threshold', minutes, intervals('threshold', reps, repMin), `Bici sweet spot ${reps}×${repMin}'`);
    expect(pickName(titled(3, 8, 55))).toBe('Sweetspot › Sweetspot #1');
    expect(pickName(titled(3, 10, 65))).toBe('Sweetspot › Sweetspot #1');
    expect(pickName(titled(2, 15, 60))).toBe('Sweetspot › Sweet Spot 15');
    expect(pickName(titled(1, 20, 45))).toBe('Sweetspot › Sweetspot 20 minute');
    // The app's sweet spot session (title "Bici sweet spot …", 88–94 % target).
    expect(bikeShape(library('BK_SST', 60)).kind).toBe('sweetspot');
  });

  test('sweet spot is also recognised by its target when the title does not say it', () => {
    const ftp = 250;
    const byPower = intervals('threshold', 3, 8, { target: { power: { min: 220, max: 235 } } });
    expect(bikeShape(bike('threshold', 55, byPower), { thresholds: { ftpW: ftp } }).kind).toBe('sweetspot');
    const byRpe = intervals('threshold', 3, 8, { target: { rpe: { min: 6, max: 7 } } });
    expect(bikeShape(bike('threshold', 55, byRpe)).kind).toBe('sweetspot');
    // Plain threshold work (zone 4, RPE 7–8 derived) stays threshold.
    expect(bikeShape(bike('threshold', 55, intervals('threshold', 3, 8))).kind).toBe('threshold');
    const hard = intervals('threshold', 3, 8, { target: { power: { min: 245, max: 260 } } });
    expect(bikeShape(bike('threshold', 55, hard), { thresholds: { ftpW: ftp } }).kind).toBe('threshold');
  });

  test('tempo: 3×10 → «Tempo #10», one long block → «Tempo #5»', () => {
    expect(pickName(bike('tempo', 70, intervals('tempo', 3, 10)))).toBe('Tempo › Tempo #10');
    expect(pickName(bike('tempo', 50, intervals('tempo', 1, 25)))).toBe('Tempo › Tempo #5');
    expect(pickName(library('BK_TEMPO', 60))).toBe('Tempo › Tempo #10');
  });

  test('recovery: «Easy Does It» or «Open Road» by duration', () => {
    expect(pickName(library('BK_REC', 30))).toBe('Beginner › Easy Does It');
    expect(pickName(library('BK_REC', 45))).toBe('Beginner › Open Road');
    expect(pickName(library('BK_REC', 60))).toBe('Endurance › Finding Your Flow');
  });

  test('endurance by duration', () => {
    expect(pickName(library('BK_END', 45))).toBe('Endurance › Base Miles #1');
    expect(pickName(library('BK_END', 60))).toBe('Endurance › Zone 2 Steady State');
    expect(pickName(library('BK_END', 90))).toBe('Endurance › 90 Minute Endurance');
    expect(pickName(library('BK_LONG', 100))).toBe('Taper › 100min Spin 90 and 80');
  });

  test('rides over ~100\' are «90 Minute Endurance» and then a free ride in zone two', () => {
    const pick = myWhooshFor(library('BK_LONG', 150));
    expect(pick?.workout.name).toBe('90 Minute Endurance');
    expect(pick?.freeRideUntil).toBe(150);
    expect(myWhooshText(pick!)).toBe(
      "MyWhoosh › Endurance › 90 Minute Endurance (Z2 con cambios del 65 al 75 %, 90') y sigue en rodada libre en zona dos hasta completar 150 minutos",
    );
  });

  test('race pace is tempo or sweet spot by how hard it is for the target race', () => {
    expect(bikeShape(library('BK_RP', 60, { raceDistance: 'half' }), { raceDistance: 'half' }).kind).toBe('tempo');
    expect(bikeShape(library('BK_RP', 60, { raceDistance: 'full' }), { raceDistance: 'full' }).kind).toBe('tempo');
    expect(bikeShape(library('BK_RP', 60, { raceDistance: 'olympic' }), { raceDistance: 'olympic' }).kind).toBe('sweetspot');
    expect(bikeShape(library('BK_RP', 60, { raceDistance: 'sprint' }), { raceDistance: 'sprint' }).kind).toBe('sweetspot');
    // Explicit watts win: 80 % FTP is tempo even for an olympic-distance athlete.
    const tempoWatts = intervals('race', 2, 20, { target: { power: { min: 190, max: 210 } } });
    expect(bikeShape(bike('race', 70, tempoWatts), { thresholds: { ftpW: 250 }, raceDistance: 'olympic' }).kind).toBe('tempo');
  });

  test('a long ride with race-pace blocks: the blocks decide, the rest is a free ride', () => {
    const ride = library('BK_LONG', 180, { raceDistance: 'half' }, { racePace: true });
    const pick = myWhooshFor(ride, { raceDistance: 'half' });
    expect(bikeShape(ride, { raceDistance: 'half' })).toEqual({ kind: 'tempo', reps: 3, repMin: 20 });
    expect(pick?.workout.name).toBe('Tempo #5');
    expect(pick?.freeRideUntil).toBe(180);
  });

  test('without steps, the title says the sets ("2×20\'") and the intensity the kind', () => {
    expect(bikeShape(bike('threshold', 70, [], "Bici umbral 2×20'"))).toEqual({ kind: 'threshold', reps: 2, repMin: 20 });
    expect(pickName(bike('threshold', 70, [], "Bici umbral 2×20'"))).toBe('Threshold › Threshold 20');
    expect(pickName(bike('threshold', 62, [], 'Bici sweet spot'))).toBe('Sweetspot › Sweet Spot 15');
    expect(bikeShape(bike('vo2', 50, [], 'VO2 4x4 min'))).toEqual({ kind: 'vo2', reps: 4, repMin: 4 });
    expect(bikeShape(bike('endurance', 60, [], 'Bici'))).toEqual({ kind: 'endurance', reps: null, repMin: null });
  });

  test('identical blocks written as separate steps count as reps', () => {
    const block: WorkoutStep = { kind: 'work', durationMin: 8, intensity: 'threshold' };
    const rest: WorkoutStep = { kind: 'recovery', durationMin: 3, intensity: 'recovery' };
    const steps = [{ kind: 'warmup', durationMin: 15 } as WorkoutStep, block, rest, block, rest, block, { kind: 'cooldown', durationMin: 10 } as WorkoutStep];
    expect(bikeShape(bike('threshold', 60, steps))).toEqual({ kind: 'threshold', reps: 3, repMin: 8 });
  });

  test('small add-ons do not change the kind of an easy ride', () => {
    const steps: WorkoutStep[] = [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery' },
      { kind: 'work', durationMin: 50, intensity: 'endurance' },
      { kind: 'work', durationMin: 0.5, intensity: 'vo2', repeat: 4 },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery' },
    ];
    expect(bikeShape(bike('endurance', 65, steps)).kind).toBe('endurance');
  });
});

describe('myWhooshText', () => {
  test('folder › name (main set, minutes)', () => {
    const pick = myWhooshFor(bike('threshold', 61, intervals('threshold', 2, 20)));
    expect(pick?.freeRideUntil).toBeNull();
    expect(myWhooshText(pick!)).toBe("MyWhoosh › Threshold › Threshold 20 (2×20' al 95 %, 61')");
    expect(myWhooshA11y(pick!)).toBe("En rodillo: MyWhoosh, carpeta Threshold, Threshold 20: 2×20' al 95 %, 61 minutos.");
  });

  test('a free ride only from FREE_RIDE_MIN extra minutes, in zone one after a recovery ride', () => {
    expect(myWhooshFor(bike('threshold', 61 + FREE_RIDE_MIN - 1, intervals('threshold', 2, 20)))?.freeRideUntil).toBeNull();
    const longer = myWhooshFor(bike('threshold', 61 + FREE_RIDE_MIN, intervals('threshold', 2, 20)));
    expect(longer?.freeRideUntil).toBe(71);
    const easy = myWhooshFor(library('BK_REC', 75));
    expect(easy?.workout.name).toBe('Finding Your Flow');
    expect(myWhooshText(easy!)).toMatch(/y sigue en rodada libre en zona uno hasta completar 75 minutos$/);
    expect(myWhooshA11y(easy!)).toMatch(/zona uno hasta completar 75 minutos\.$/);
  });
});
