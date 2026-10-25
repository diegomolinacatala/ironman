import { addDays } from '../dates';
import { planWeek } from '../planner';
import { consumeExisting, historyCaps, raceWeekSessions, rampCapMinutes, trimToBudget, tsbGuard } from '../plannerSupport';
import type { Placed } from '../placement';
import type { SessionSpec } from '../sessions';
import { makeProfile, makeRace, makeWorkout, NEXT_MONDAY } from './fixtures';

describe('historyCaps', () => {
  test('Frandsen cap from the longest run, pace from history', () => {
    const history = [makeWorkout({ date: '2026-10-20', sport: 'run', status: 'completed', durationMin: 50, distanceM: 10000, completed: { durationMin: 50, distanceM: 10000 } })];
    const caps = historyCaps(history, NEXT_MONDAY, {});
    expect(caps.longestRunM).toBe(10000);
    expect(caps.runPaceMinPerKm).toBeCloseTo(5, 5);
    expect(caps.runLongMax).toBe(55);
    expect(caps.bikeLongMax).toBeNull();
  });

  test('5 km floor and threshold pace fallback; old runs ignored', () => {
    const history = [
      makeWorkout({ date: '2026-10-22', sport: 'run', status: 'completed', durationMin: 20, distanceM: 3000, completed: { durationMin: 20, distanceM: 3000 } }),
      makeWorkout({ date: '2026-08-01', sport: 'run', status: 'completed', durationMin: 120, distanceM: 21000, completed: { durationMin: 120, distanceM: 21000 } }),
      makeWorkout({ date: '2026-10-21', sport: 'bike', status: 'completed', durationMin: 100, completed: { durationMin: 100 } }),
    ];
    const caps = historyCaps(history, NEXT_MONDAY, { runThresholdPaceSecPerKm: 300 });
    expect(caps.longestRunM).toBe(3000);
    expect(caps.runLongMax).toBe(30);
    expect(caps.bikeLongMax).toBe(120);
    expect(historyCaps([], NEXT_MONDAY, { runThresholdPaceSecPerKm: 300 }).runLongMax).toBeNull();
  });
});

describe('rampCapMinutes', () => {
  test('null without history, tighter for beginners and life stress', () => {
    expect(rampCapMinutes({ recentWeeklyMinutes: undefined, level: 'intermediate', lifeStress: false })).toBeNull();
    expect(rampCapMinutes({ recentWeeklyMinutes: [0, 0, 0], level: 'intermediate', lifeStress: false })).toBeNull();
    const normal = rampCapMinutes({ recentWeeklyMinutes: [300, 320, 280, 340], level: 'intermediate', lifeStress: false }) ?? 0;
    const beginner = rampCapMinutes({ recentWeeklyMinutes: [300, 320, 280, 340], level: 'beginner', lifeStress: false }) ?? 0;
    const stressed = rampCapMinutes({ recentWeeklyMinutes: [300, 320, 280, 340], level: 'intermediate', lifeStress: true }) ?? 0;
    expect(normal).toBeGreaterThan(beginner);
    expect(beginner).toBeGreaterThan(stressed);
    expect(normal).toBeGreaterThan(310);
  });
});

describe('consumeExisting and trimToBudget', () => {
  const specs: SessionSpec[] = [
    { code: 'BK_LONG', durationMin: 150, priority: 1 },
    { code: 'BK_THR', durationMin: 75, priority: 2 },
    { code: 'RN_LONG', durationMin: 90, priority: 1 },
    { code: 'RN_EASY', durationMin: 45, priority: 5 },
    { code: 'SW_TECH', durationMin: 30, priority: 7 },
  ];

  test('existing workouts consume the matching role', () => {
    const left = consumeExisting(specs, [
      { id: 'a', date: '2026-10-31', sport: 'brick', intensity: 'endurance', durationMin: 120, startTime: null },
      { id: 'b', date: '2026-11-01', sport: 'run', intensity: 'endurance', durationMin: 85, startTime: null },
      { id: 'c', date: '2026-10-28', sport: 'strength', intensity: 'endurance', durationMin: 30, startTime: null },
    ]);
    expect(left.map((s) => s.code)).toEqual(['BK_LONG', 'RN_EASY', 'SW_TECH']);
  });

  test('trim shortens easy, then key sessions to 75 %, then drops the least important', () => {
    const total = (xs: SessionSpec[]) => xs.reduce((s, x) => s + x.durationMin, 0);
    expect(total(trimToBudget(specs, 380))).toBeLessThanOrEqual(380);
    const tight = trimToBudget(specs, 150);
    expect(total(tight)).toBeLessThanOrEqual(150);
    expect(tight.some((s) => s.code === 'SW_TECH')).toBe(false);
    expect(trimToBudget(specs, 10_000)).toEqual(specs);
  });
});

describe('raceWeekSessions', () => {
  test('target race: race, activation, spark and easy swim; C race only the race', () => {
    const race = makeRace({ date: '2026-11-01', distance: 'olympic' });
    const target = raceWeekSessions(race, true, 'tri_short', NEXT_MONDAY);
    expect(target.map((s) => s.code)).toEqual(['RACE', 'ACTIVATION', 'BRICK', 'SW_TECH']);
    expect(target[0]?.allowedDates).toEqual(['2026-11-01']);
    const run = raceWeekSessions(makeRace({ date: '2026-11-01', distance: 'run_10k' }), true, 'run', NEXT_MONDAY);
    expect(run.map((s) => s.code)).toEqual(['RACE', 'ACTIVATION', 'RN_THR']);
    expect(raceWeekSessions(makeRace({ date: '2026-11-01', priority: 'C' }), false, 'tri_short', NEXT_MONDAY)).toHaveLength(1);
    expect(raceWeekSessions(makeRace({ date: '2026-11-01', priority: 'B' }), false, 'tri_short', NEXT_MONDAY)).toHaveLength(2);
    expect(raceWeekSessions(race, true, 'tri_short', '2026-11-02')).toEqual([]);
  });
});

describe('tsbGuard (L11)', () => {
  const range = { from: NEXT_MONDAY, to: addDays(NEXT_MONDAY, 6) };
  const placed = (code: SessionSpec['code'], durationMin: number, day: number, priority = 5): Placed => ({
    spec: { code, durationMin, priority },
    date: addDays(NEXT_MONDAY, day),
    startTime: null,
    adjusted: false,
  });

  test('no history → untouched', () => {
    const r = tsbGuard({ range, history: [], fixedLoads: {}, placed: [placed('BK_END', 60, 1)] });
    expect(r.minTsb).toBeNull();
    expect(r.placed).toHaveLength(1);
  });

  test('a huge week after steady training drops the least important sessions and warns', () => {
    const sessions = [
      placed('BK_LONG', 300, 0, 1),
      placed('BK_LONG', 300, 1, 1),
      placed('BK_LONG', 300, 2, 1),
      placed('BK_END', 120, 3, 5),
      placed('BK_END', 120, 4, 5),
      placed('BK_LONG', 300, 5, 1),
    ];
    const r = tsbGuard({ range, history: [], recentWeeklyMinutes: [240, 240, 240, 240], fixedLoads: {}, placed: sessions });
    expect(r.removed.length).toBeGreaterThan(0);
    expect(r.removed[0]?.spec.code).toBe('BK_END');
    expect(r.warning).toMatch(/fatiga/);
  });

  test('history seeds the PMC; past fatigue alone is not blamed on the plan', () => {
    const history = Array.from({ length: 7 }, (_, i) =>
      makeWorkout({ id: `h${i}`, date: addDays(NEXT_MONDAY, -(i + 1)), sport: 'bike', status: 'completed', completed: { tss: 220, durationMin: 240 } }),
    );
    const r = tsbGuard({ range, history, fixedLoads: {}, placed: [placed('SW_TECH', 30, 2)] });
    expect(r.minTsb).toBeLessThan(-30);
    expect(r.removed).toEqual([]);
  });

  test('planWeek reports projected freshness when history exists', () => {
    const history = [makeWorkout({ id: 'h', date: '2026-10-20', sport: 'run', status: 'completed', durationMin: 60, distanceM: 10000, completed: { durationMin: 60, distanceM: 10000, tss: 60 } })];
    const r = planWeek({ weekStart: NEXT_MONDAY, profile: makeProfile(), races: [makeRace()], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [], history });
    expect(typeof r.projectedMinTsb).toBe('number');
  });
});
