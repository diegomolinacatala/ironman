/** Placement hard rules: race-week rules for A/B races, L03, brick vs bike/run, day caps. */
import { addDays, daysInRange } from '../dates';
import { dayHardPoints, placeSessions, type PlacementContext } from '../placement';
import { NO_RESTRICTION } from '../restrictions';
import { specHardPoints, specSport, type SessionSpec } from '../sessions';
import type { TrainingWindow } from '../types';
import { buildWeekModel, type DayState } from '../weekModel';

const MON = '2027-03-22';
const SAT = '2027-03-27';
const SUN = '2027-03-28';

function week(windows: TrainingWindow[] = []): DayState[] {
  const dates = daysInRange({ from: MON, to: addDays(MON, 6) });
  return buildWeekModel({
    dates,
    firstPlannable: MON,
    restDay: null,
    longSessionDays: [5, 6],
    poolDays: [],
    windows,
    busyBlocks: [],
    fixed: [],
    lifeEvents: [],
    restrictions: Object.fromEntries(dates.map((d) => [d, NO_RESTRICTION])),
  });
}

const ctx: PlacementContext = { kind: 'tri_short', maxHardDays: 4, bigWeekendAllowed: false, aRaceDates: [], readinessToday: null };

const HARD_WEEK: SessionSpec[] = [
  { code: 'BK_THR', durationMin: 60, priority: 2 },
  { code: 'RN_THR', durationMin: 50, priority: 2 },
  { code: 'BK_TEMPO', durationMin: 60, priority: 3 },
  { code: 'RN_EASY', durationMin: 40, priority: 5 },
  { code: 'BK_END', durationMin: 60, priority: 5 },
  { code: 'SW_END', durationMin: 40, priority: 5 },
];

function hardOn(result: ReturnType<typeof placeSessions>, date: string): number {
  return result.placed.filter((p) => p.date === date).reduce((s, p) => s + specHardPoints(p.spec), 0);
}

describe('B race mini-taper (§5.3)', () => {
  const race: SessionSpec = { code: 'RACE', durationMin: 150, priority: 0, sport: 'brick', raceName: 'Olímpico B', allowedDates: [SUN] };

  test('without the B-race rules a hard session would land 48 h before; with them it does not', () => {
    const control = placeSessions([race, ...HARD_WEEK], week(), ctx);
    const before = [addDays(SUN, -2), addDays(SUN, -1)];
    expect(before.some((d) => hardOn(control, d) >= 1)).toBe(true);
    const r = placeSessions([race, ...HARD_WEEK], week(), { ...ctx, bRaceDates: [SUN] });
    expect(r.placed.some((p) => p.date === SUN && p.spec.code === 'RACE')).toBe(true);
    for (const d of before) expect(hardOn(r, d)).toBeLessThan(1);
  });

  test('two easy days after a midweek B race', () => {
    const wed = addDays(MON, 2);
    const midweek: SessionSpec = { ...race, allowedDates: [wed] };
    const control = placeSessions([midweek, ...HARD_WEEK], week(), ctx);
    expect([addDays(wed, 1), addDays(wed, 2)].some((d) => hardOn(control, d) > 0)).toBe(true);
    const r = placeSessions([midweek, ...HARD_WEEK], week(), { ...ctx, bRaceDates: [wed] });
    for (const d of [addDays(wed, 1), addDays(wed, 2)]) expect(hardOn(r, d)).toBe(0);
  });
});

describe('C race: easy day before (§5.3)', () => {
  test('no quality session on D−1 of a C race', () => {
    const specs: SessionSpec[] = [
      { code: 'RACE', durationMin: 55, priority: 0, sport: 'run', raceName: '10 km', allowedDates: [SUN] },
      { code: 'SW_CSS', durationMin: 45, priority: 2, allowedDates: [SAT] },
    ];
    expect(placeSessions(specs, week(), ctx).placed.some((p) => p.spec.code === 'SW_CSS')).toBe(true);
    const r = placeSessions(specs, week(), { ...ctx, cRaceDates: [SUN] });
    expect(r.placed.some((p) => p.spec.code === 'SW_CSS')).toBe(false);
    // The series become an easy swim instead.
    expect(r.placed.find((p) => p.date === SAT)?.spec.code).toBe('SW_END');
  });
});

describe('A race: D−1 activation only, D−2 rest or easy swim (§5.4)', () => {
  test('even when the race is next Monday', () => {
    const nextMon = addDays(MON, 7);
    const r = placeSessions(HARD_WEEK, week(), { ...ctx, aRaceDates: [nextMon] });
    expect(r.placed.filter((p) => p.date === SUN)).toEqual([]);
    expect(r.placed.filter((p) => p.date === SAT).every((p) => specSport(p.spec) === 'swim' && specHardPoints(p.spec) === 0)).toBe(true);
  });
});

describe('L03 and same-sport rules', () => {
  test('after a ≥ 2-point day the next day gets 0 points', () => {
    const r = placeSessions(
      [
        { code: 'BRICK', durationMin: 150, priority: 1, brickRunMin: 20, allowedDates: [SAT] },
        { code: 'SW_CSS', durationMin: 45, priority: 1, allowedDates: [SAT] },
        { code: 'RN_THR', durationMin: 50, priority: 2, allowedDates: [SUN] },
      ],
      week(),
      ctx,
    );
    const points = dayHardPoints(week(), r.placed);
    expect(points[5]).toBeGreaterThanOrEqual(2);
    expect(points[6]).toBe(0);
  });

  test('a brick is never stacked with another ride or run on the same day', () => {
    const windows: TrainingWindow[] = [
      ...[0, 1, 2, 3, 4].map((weekday) => ({ weekday: weekday as 0, start: '18:00', end: '19:15' })),
      { weekday: 5, start: '07:00', end: '14:00' },
    ];
    const specs: SessionSpec[] = [
      { code: 'BRICK', durationMin: 170, priority: 1, brickRunMin: 20 },
      { code: 'BK_END', durationMin: 75, priority: 5 },
      { code: 'RN_EASY', durationMin: 45, priority: 5 },
    ];
    const r = placeSessions(specs, week(windows), ctx);
    const brick = r.placed.find((p) => p.spec.code === 'BRICK');
    expect(brick).toBeDefined();
    expect(r.placed.some((p) => p.date === brick?.date && p.spec.code !== 'BRICK' && ['bike', 'run'].includes(specSport(p.spec)))).toBe(false);
  });

  test('a capped easy day never exceeds its minutes', () => {
    const days = week().map((d, i) => (i === 1 ? { ...d, dayCapMin: 60 } : d));
    const specs: SessionSpec[] = Array.from({ length: 6 }, (_, i) => ({ code: 'BK_END', durationMin: 50 + i * 5, priority: 5, allowedDates: [addDays(MON, 1)] }));
    const r = placeSessions([...specs, { code: 'MOB', durationMin: 15, priority: 7, allowedDates: [addDays(MON, 1)] }], days, ctx);
    const total = r.placed.filter((p) => p.date === addDays(MON, 1)).reduce((s, p) => s + p.spec.durationMin, 0);
    expect(total).toBeLessThanOrEqual(60);
    expect(total).toBeGreaterThan(0);
  });
});
