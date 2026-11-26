/**
 * Weekly run cap (runVolume.ts) in the allocation and the weekly planner:
 * running never grows more than 15 % over the biggest run week of the last 3.
 */
import { allocateSessions, allocateWeek, type AllocationInput } from '../allocation';
import { addDays } from '../dates';
import { phaseFor } from '../periodization';
import { planWeek, type PlannerInput } from '../planner';
import { capRunSpecs, specRunMinutes } from '../plannerSupport';
import { workoutRunMinutes } from '../runVolume';
import type { SessionSpec } from '../sessions';
import type { PlanChange, Sport, WorkoutDraft } from '../types';
import { makeProfile, makeRace, makeWorkout } from './fixtures';

function runMinutes(specs: readonly SessionSpec[]): number {
  return specs.reduce((sum, s) => sum + specRunMinutes(s), 0);
}

function sportMinutes(specs: readonly SessionSpec[], sports: readonly Sport[]): number {
  return specs.filter((s) => sports.includes(s.sport ?? (s.code.startsWith('SW') ? 'swim' : s.code.startsWith('BK') ? 'bike' : 'other'))).reduce((sum, s) => sum + s.durationMin, 0);
}

describe('allocation with the weekly run cap', () => {
  const half = makeRace();
  const base = (runWeekMax: number | null, overrides: Partial<AllocationInput> = {}): AllocationInput => ({
    phase: phaseFor('2027-02-08', [half], { level: 'intermediate' }),
    distance: 'half',
    kind: 'tri_long',
    minutes: 840,
    sports: ['swim', 'bike', 'run', 'strength'],
    qualityCut: 0,
    qualityCap: null,
    blockedAllWeek: [],
    substitutes: {},
    easyOnlyAllWeek: [],
    caps: { runLongMax: 65, bikeLongMax: 140, runWeekMax },
    ...overrides,
  });

  test('without a cap nothing changes', () => {
    const free = allocateWeek(base(null));
    expect(free.runCappedMin).toBe(0);
    expect(free.specs).toEqual(allocateSessions(base(null)));
    expect(allocateWeek(base(1000)).specs).toEqual(free.specs);
  });

  test('a triathlete keeps the long run and the quality run, drops easy runs and rides or swims the rest', () => {
    const free = allocateWeek(base(null)).specs;
    const capped = allocateWeek(base(121));
    expect(runMinutes(free)).toBeGreaterThan(121);
    expect(runMinutes(capped.specs)).toBeLessThanOrEqual(121);
    expect(capped.runCappedMin).toBeGreaterThan(0);
    const runCodes = capped.specs.filter((s) => s.code.startsWith('RN_')).map((s) => s.code);
    expect(runCodes).toEqual(expect.arrayContaining(['RN_LONG', 'RN_THR']));
    expect(runCodes).not.toContain('RN_EASY');
    expect(sportMinutes(capped.specs, ['bike', 'swim'])).toBeGreaterThan(sportMinutes(free, ['bike', 'swim']));
  });

  test('a run-only plan just gets a shorter week', () => {
    const tenK = makeRace({ id: 'r10', distance: 'run_10k', date: '2027-04-25' });
    const input = (max: number | null) =>
      base(max, { phase: phaseFor('2027-02-22', [tenK], { level: 'intermediate' }), distance: 'run_10k', kind: 'run', minutes: 420, sports: ['run', 'bike', 'strength'] });
    const free = allocateWeek(input(null)).specs;
    const capped = allocateWeek(input(200)).specs;
    expect(runMinutes(free)).toBeGreaterThan(200);
    expect(runMinutes(capped)).toBeLessThanOrEqual(200);
    expect(sportMinutes(capped, ['bike'])).toBe(sportMinutes(free, ['bike']));
    expect(capped.reduce((s, x) => s + x.durationMin, 0)).toBeLessThan(free.reduce((s, x) => s + x.durationMin, 0));
  });
});

describe('capRunSpecs', () => {
  const specs: SessionSpec[] = [
    { code: 'RN_LONG', durationMin: 80, priority: 1, distanceM: 14000 },
    { code: 'RN_THR', durationMin: 50, priority: 2 },
    { code: 'RN_EASY', durationMin: 45, priority: 5 },
    { code: 'BRICK', durationMin: 120, brickRunMin: 20, racePace: true, priority: 1 },
    { code: 'ACTIVATION', durationMin: 25, priority: 2, sport: 'run', allowedDates: ['2026-10-31'] },
    { code: 'BK_END', durationMin: 90, priority: 5 },
  ];

  test('no cap or enough room: unchanged', () => {
    expect(capRunSpecs(specs, null)).toEqual({ specs, trimmed: 0 });
    expect(capRunSpecs(specs, 300)).toEqual({ specs, trimmed: 0 });
  });

  test('easy runs go first, key runs keep 75 %, bricks and pinned sessions stay; distances follow', () => {
    // 150' of room: the brick's 20' run leg and the pinned 25' activation leave 105' for the free runs.
    const { specs: out, trimmed } = capRunSpecs(specs, 150);
    expect(out.map((s) => `${s.code} ${s.durationMin}`)).toEqual(['RN_LONG 60', 'RN_THR 40', 'BRICK 120', 'ACTIVATION 25', 'BK_END 90']);
    expect(out[0]?.distanceM).toBe(10500);
    expect(trimmed).toBe(75);
    expect(runMinutes(out)).toBeLessThanOrEqual(150);
  });
});

describe('weekly planner with the run cap', () => {
  const profile = makeProfile({ availability: { ...makeProfile().availability, weeklyHoursTarget: 10 } });
  /** Three weeks before 2027-03-22 with 2 × 30' runs and 2 × 90' rides: the cap is 70'. */
  const history = ['2027-03-01', '2027-03-08', '2027-03-15'].flatMap((monday, i) => [
    makeWorkout({ id: `r${i}a`, date: addDays(monday, 1), sport: 'run', status: 'completed', durationMin: 30, completed: { durationMin: 30 } }),
    makeWorkout({ id: `r${i}b`, date: addDays(monday, 3), sport: 'run', status: 'completed', durationMin: 30, completed: { durationMin: 30 } }),
    makeWorkout({ id: `b${i}a`, date: addDays(monday, 2), sport: 'bike', status: 'completed', durationMin: 90, completed: { durationMin: 90 } }),
    makeWorkout({ id: `b${i}b`, date: addDays(monday, 5), sport: 'bike', status: 'completed', durationMin: 90, completed: { durationMin: 90 } }),
  ]);
  const input = (overrides: Partial<PlannerInput> = {}): PlannerInput => ({
    weekStart: '2027-03-22',
    profile,
    races: [makeRace()],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    history,
    ...overrides,
  });
  const drafts = (changes: PlanChange[]): WorkoutDraft[] => changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
  const plannedRun = (changes: PlanChange[]): number => drafts(changes).reduce((sum, d) => sum + workoutRunMinutes({ ...d, status: 'planned' }), 0);

  test('the week runs at most +15 % over the biggest recent run week and says so', () => {
    const r = planWeek(input());
    expect(r.runCapMinutes).toBe(70);
    expect(plannedRun(r.changes)).toBeLessThanOrEqual(70);
    expect(r.summary).toMatch(/He limitado la carrera a pie a 1h 10' esta semana/);
  });

  test('without history there is no cap', () => {
    const r = planWeek(input({ history: undefined }));
    expect(r.runCapMinutes).toBeNull();
    expect(plannedRun(r.changes)).toBeGreaterThan(70);
    expect(r.summary).not.toMatch(/carrera a pie/);
  });

  test('runs already done this week or already planned count: no new runs over the cap', () => {
    const done = [
      makeWorkout({ id: 'mon', date: '2027-03-22', sport: 'run', status: 'completed', durationMin: 40, completed: { durationMin: 40 } }),
      makeWorkout({ id: 'tue', date: '2027-03-23', sport: 'run', status: 'completed', durationMin: 35, completed: { durationMin: 35 } }),
    ];
    const midweek = planWeek(input({ existing: done, today: '2027-03-24' }));
    expect(drafts(midweek.changes).filter((d) => d.sport === 'run')).toEqual([]);
    const planned = done.map((w) => ({ ...w, status: 'planned' as const, completed: null, date: addDays(w.date, 3) }));
    const full = planWeek(input({ existing: planned }));
    expect(drafts(full.changes).filter((d) => d.sport === 'run')).toEqual([]);
  });
});
