import { recentRunMinutes, runWeekCapMinutes, workoutRunMinutes } from '../runVolume';
import type { WorkoutStep } from '../types';
import { makeWorkout, NEXT_MONDAY } from './fixtures';

/** 50' of bike and 30' running off the bike. */
const BRICK_STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 10, intensity: 'recovery', leg: 'bike' },
  { kind: 'work', durationMin: 40, intensity: 'endurance', leg: 'bike' },
  { kind: 'work', durationMin: 30, intensity: 'endurance', leg: 'run' },
];

describe('workoutRunMinutes', () => {
  test('a run counts whole, done minutes once completed; other sports count nothing', () => {
    expect(workoutRunMinutes(makeWorkout({ sport: 'run', durationMin: 45 }))).toBe(45);
    expect(workoutRunMinutes(makeWorkout({ sport: 'run', durationMin: 45, status: 'completed', completed: { durationMin: 52 } }))).toBe(52);
    expect(workoutRunMinutes(makeWorkout({ sport: 'bike', durationMin: 90 }))).toBe(0);
    expect(workoutRunMinutes(makeWorkout({ sport: 'swim', durationMin: 45, status: 'completed', completed: { durationMin: 45 } }))).toBe(0);
  });

  test('a brick counts its run leg: the share of its tagged run steps, else a quarter of it', () => {
    expect(workoutRunMinutes(makeWorkout({ sport: 'brick', durationMin: 80, steps: BRICK_STEPS }))).toBe(30);
    expect(workoutRunMinutes(makeWorkout({ sport: 'brick', durationMin: 80, steps: [] }))).toBe(20);
    expect(workoutRunMinutes(makeWorkout({ sport: 'brick', durationMin: 80, steps: BRICK_STEPS, status: 'completed', completed: { durationMin: 100 } }))).toBe(37.5);
  });
});

describe('recentRunMinutes', () => {
  const done = (date: string, sport: 'run' | 'bike', minutes: number) =>
    makeWorkout({ date, sport, durationMin: minutes, status: 'completed', completed: { durationMin: minutes } });

  test('completed run minutes of each of the 3 weeks before, oldest first', () => {
    const workouts = [
      done('2026-10-06', 'run', 40),
      done('2026-10-08', 'run', 30),
      done('2026-10-15', 'run', 60),
      done('2026-10-19', 'bike', 120),
      done('2026-10-25', 'run', 50),
      // Outside the window: the planned week itself, a month ago, and skipped / planned runs.
      done(NEXT_MONDAY, 'run', 90),
      done('2026-09-20', 'run', 200),
      makeWorkout({ date: '2026-10-21', sport: 'run', durationMin: 70, status: 'skipped' }),
      makeWorkout({ date: '2026-10-22', sport: 'run', durationMin: 70 }),
    ];
    expect(recentRunMinutes(workouts, NEXT_MONDAY)).toEqual([70, 60, 50]);
  });

  test('null without any completed workout; zeros when only other sports were done', () => {
    expect(recentRunMinutes([], NEXT_MONDAY)).toBeNull();
    expect(recentRunMinutes([makeWorkout({ date: '2026-10-20', sport: 'run', durationMin: 60 })], NEXT_MONDAY)).toBeNull();
    expect(recentRunMinutes([done('2026-10-20', 'bike', 90)], NEXT_MONDAY)).toEqual([0, 0, 0]);
  });
});

describe('runWeekCapMinutes', () => {
  test('+15 % over the biggest recent run week', () => {
    expect(runWeekCapMinutes([100, 150, 120])).toBe(173);
    expect(runWeekCapMinutes([200, 0, 0])).toBe(230);
  });

  test('low volumes still grow 10 minutes and the floor allows two short runs', () => {
    expect(runWeekCapMinutes([60, 40, 50])).toBe(70);
    expect(runWeekCapMinutes([30, 20, 0])).toBe(50);
    expect(runWeekCapMinutes([0, 0, 0])).toBe(50);
  });

  test('no history, no cap', () => {
    expect(runWeekCapMinutes(null)).toBeNull();
    expect(runWeekCapMinutes(undefined)).toBeNull();
    expect(runWeekCapMinutes([])).toBeNull();
  });
});
