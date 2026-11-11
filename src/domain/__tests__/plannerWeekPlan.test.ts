/** v4: the week-level override (Plan → General) in the weekly planner, the allocation and the re-planner. */
import { allocateSessions, type AllocationInput } from '../allocation';
import { addDays } from '../dates';
import { phaseFor } from '../periodization';
import { generateWeek, lowIntensityShare, planWeek, type PlannerInput } from '../planner';
import { activeWeekPlan } from '../plannerSupport';
import { replanMissed } from '../replanner';
import { applyWeekPlan, canOverride } from '../season';
import { specClass, specIntensity } from '../sessions';
import type { PlanChange, Profile, WeekPlan } from '../types';
import { makeProfile, makeRace, makeWorkout } from './fixtures';

/** Medio de Valencia (half, A) on 2027-04-25, added on 2026-10-25. */
const RACE = makeRace();
/** Build2 load week; the week before is the descarga inside build2. */
const LOAD_WEEK = '2027-03-22';
const DESCARGA_WEEK = '2027-03-15';
const TAPER_WEEK = '2027-04-12';
const RACE_WEEK = '2027-04-19';

function plan(weekStart: string, kind: WeekPlan['kind'], extra: Partial<WeekPlan> = {}): WeekPlan {
  return { weekStart, kind, targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-11-09T10:00:00Z', ...extra };
}

function withHours(hours: number): Profile {
  const base = makeProfile();
  return { ...base, availability: { ...base.availability, weeklyHoursTarget: hours } };
}

function input(weekStart: string, overrides: Partial<PlannerInput> = {}): PlannerInput {
  return { weekStart, profile: makeProfile(), races: [RACE], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [], ...overrides };
}

/** Minutes the proposal adds (there is no race in the weeks measured this way). */
function plannedMinutes(changes: readonly PlanChange[]): number {
  return changes.reduce((sum, c) => sum + (c.op === 'add' ? c.workout.durationMin : 0), 0);
}

describe('generateWeek with a week plan (Plan → General)', () => {
  test('the weeks used here: a build load week, its descarga, the taper and the race week', () => {
    const load = phaseFor(LOAD_WEEK, [RACE]);
    expect(load.phase).toBe('build');
    expect(load.isRecoveryWeek).toBe(false);
    expect(canOverride(load)).toBe(true);
    expect(phaseFor(DESCARGA_WEEK, [RACE]).isRecoveryWeek).toBe(true);
    expect(phaseFor(TAPER_WEEK, [RACE]).phase).toBe('taper');
    expect(phaseFor(RACE_WEEK, [RACE]).phase).toBe('race_week');
  });

  test('a descarga lowers the planned minutes and the summary says so', () => {
    const weekPlan = plan(LOAD_WEEK, 'recovery');
    const base = generateWeek(input(LOAD_WEEK));
    const down = generateWeek(input(LOAD_WEEK, { weekPlan }));
    expect(plannedMinutes(down.changes)).toBeLessThan(plannedMinutes(base.changes) * 0.75);
    expect(down.summary).toContain('Semana ajustada: descarga.');
    expect(down.summary).not.toContain('(descarga)');
    expect(base.summary).not.toContain('Semana ajustada');
    const result = planWeek(input(LOAD_WEEK, { weekPlan }));
    expect(result.phase.isRecoveryWeek).toBe(true);
    expect(result.phase).toEqual(applyWeekPlan(phaseFor(LOAD_WEEK, [RACE], { level: 'intermediate' }), weekPlan, 9));
  });

  test('más volumen raises them about 10 % and keeps ≥ 75 % in Z1-Z2', () => {
    const weekPlan = plan(LOAD_WEEK, 'push');
    const base = planWeek(input(LOAD_WEEK));
    const up = planWeek(input(LOAD_WEEK, { weekPlan }));
    expect(up.targetMinutes / base.targetMinutes).toBeCloseTo(1.1, 1);
    expect(plannedMinutes(generateWeek(input(LOAD_WEEK, { weekPlan })).changes)).toBeGreaterThan(plannedMinutes(generateWeek(input(LOAD_WEEK)).changes));
    expect(lowIntensityShare(up.placed.map((p) => p.spec))).toBeGreaterThanOrEqual(0.75);
    expect(up.summary).toContain('Semana ajustada: más volumen.');
  });

  test('explicit minutes set the week and the proposal follows them', () => {
    const profile = withHours(10);
    for (const minutes of [300, 450]) {
      const weekPlan = plan(LOAD_WEEK, 'load', { targetMinutes: minutes });
      expect(planWeek(input(LOAD_WEEK, { profile, weekPlan })).targetMinutes).toBe(minutes);
      const planned = plannedMinutes(generateWeek(input(LOAD_WEEK, { profile, weekPlan })).changes);
      expect(Math.abs(planned - minutes)).toBeLessThanOrEqual(minutes * 0.1);
    }
    const summary = generateWeek(input(LOAD_WEEK, { profile, weekPlan: plan(LOAD_WEEK, 'load', { targetMinutes: 300 }) })).summary;
    expect(summary).toContain('Semana ajustada: carga (5h).');
  });

  test('"Carga" on a scheduled descarga brings back the load volume', () => {
    const descarga = planWeek(input(DESCARGA_WEEK));
    const load = planWeek(input(DESCARGA_WEEK, { weekPlan: plan(DESCARGA_WEEK, 'load') }));
    expect(load.phase.isRecoveryWeek).toBe(false);
    expect(load.targetMinutes).toBeGreaterThan(descarga.targetMinutes * 1.3);
    expect(plannedMinutes(load.changes)).toBeGreaterThan(plannedMinutes(descarga.changes));
    expect(load.summary).toContain('Semana ajustada: carga.');
  });

  test('semana libre: little volume, easy sessions only, no long ones; the note reaches the summary', () => {
    const base = planWeek(input(LOAD_WEEK));
    const free = planWeek(input(LOAD_WEEK, { weekPlan: plan(LOAD_WEEK, 'rest', { note: 'Vacaciones en la playa.' }) }));
    expect(free.targetMinutes).toBeLessThan(base.targetMinutes * 0.45);
    expect(free.placed.length).toBeGreaterThan(0);
    for (const p of free.placed) {
      expect(['endurance', 'recovery']).toContain(specIntensity(p.spec));
      expect(['QUALITY', 'BRICK', 'LONG']).not.toContain(specClass(p.spec));
    }
    expect(free.summary).toContain('Semana ajustada: libre.');
    expect(free.summary).not.toContain('(descarga)');
    expect(free.summary).toContain('Vacaciones en la playa.');
    expect(free.summary).not.toMatch(/Largas:/);
  });

  test('the ramp cap and the readiness still apply on top of the override', () => {
    const weekPlan = plan(LOAD_WEEK, 'push');
    const pushed = planWeek(input(LOAD_WEEK, { weekPlan }));
    const capped = planWeek(input(LOAD_WEEK, { weekPlan, recentWeeklyMinutes: [240, 250, 230, 260] }));
    expect(capped.targetMinutes).toBeLessThan(pushed.targetMinutes);
    expect(capped.summary).toMatch(/limitado la carga/);
    const red = { score: 20, level: 'red' as const, factors: ['FC en reposo +9 lpm sobre tu media'], recommendation: '' };
    expect(planWeek(input(LOAD_WEEK, { weekPlan, readiness: red })).targetMinutes).toBeLessThan(pushed.targetMinutes);
  });

  test('taper and race weeks ignore any override', () => {
    for (const week of [TAPER_WEEK, RACE_WEEK]) {
      expect(canOverride(phaseFor(week, [RACE]))).toBe(false);
      const control = planWeek(input(week));
      for (const kind of ['load', 'push', 'recovery', 'rest'] as const) {
        const weekPlan = plan(week, kind, { targetMinutes: kind === 'push' ? 900 : null });
        expect(planWeek(input(week, { weekPlan }))).toEqual(control);
      }
      expect(generateWeek(input(week, { weekPlan: plan(week, 'rest') })).summary).not.toContain('Semana ajustada');
    }
  });

  test('a plan for another week, or no plan, changes nothing', () => {
    const control = planWeek(input(LOAD_WEEK));
    expect(planWeek(input(LOAD_WEEK, { weekPlan: plan(DESCARGA_WEEK, 'rest') }))).toEqual(control);
    expect(planWeek(input(LOAD_WEEK, { weekPlan: null }))).toEqual(control);
  });
});

describe('activeWeekPlan', () => {
  test('only the plan of this very week, and only on weeks that can change', () => {
    const info = phaseFor(LOAD_WEEK, [RACE]);
    const push = plan(LOAD_WEEK, 'push');
    expect(activeWeekPlan(info, push, LOAD_WEEK)).toBe(push);
    expect(activeWeekPlan(info, push, DESCARGA_WEEK)).toBeNull();
    expect(activeWeekPlan(info, null, LOAD_WEEK)).toBeNull();
    expect(activeWeekPlan(info, undefined, LOAD_WEEK)).toBeNull();
    expect(activeWeekPlan(phaseFor(RACE_WEEK, [RACE]), plan(RACE_WEEK, 'push'), RACE_WEEK)).toBeNull();
  });
});

describe('allocateSessions — semana libre', () => {
  const allocation: AllocationInput = {
    phase: phaseFor(LOAD_WEEK, [RACE]),
    distance: 'half',
    kind: 'tri_long',
    minutes: 540,
    sports: ['swim', 'bike', 'run', 'strength'],
    qualityCut: 0,
    qualityCap: null,
    blockedAllWeek: [],
    substitutes: {},
    easyOnlyAllWeek: [],
    caps: { runLongMax: null, bikeLongMax: null },
  };

  test('a free week has no quality, brick, long or heavy sessions, even in a build phase', () => {
    const hard = (classes: string[]) => classes.filter((c) => c === 'QUALITY' || c === 'BRICK' || c === 'LONG');
    expect(hard(allocateSessions(allocation).map(specClass)).length).toBeGreaterThan(0);
    const free = allocateSessions({ ...allocation, freeWeek: true });
    expect(free.length).toBeGreaterThan(0);
    expect(hard(free.map(specClass))).toEqual([]);
    expect(free.every((s) => specIntensity(s) === 'endurance' || specIntensity(s) === 'recovery')).toBe(true);
  });
});

describe('replanMissed with a week plan', () => {
  /** No race: maintenance weeks (2026-10-26 is a load week, 2026-11-16 a descarga). */
  const LOAD_MONDAY = '2026-10-26';
  const DESCARGA_MONDAY = '2026-11-16';
  const profile = makeProfile();

  function missedKey(monday: string) {
    const workouts = [
      makeWorkout({ id: 'mon-thr', date: monday, sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series', isKey: true }),
      makeWorkout({ id: 'thu-swim', date: addDays(monday, 3), sport: 'swim', durationMin: 40 }),
      makeWorkout({ id: 'sat-long', date: addDays(monday, 5), sport: 'bike', durationMin: 150, isKey: true }),
    ];
    return { today: addDays(monday, 1), weekWorkouts: workouts, profile, races: [], missed: workouts.slice(0, 1) };
  }

  function touches(changes: readonly PlanChange[], id: string): boolean {
    return changes.some((c) => c.op !== 'add' && c.workoutId === id);
  }

  test('the weeks used here', () => {
    expect(phaseFor(LOAD_MONDAY, []).isRecoveryWeek).toBe(false);
    expect(phaseFor(DESCARGA_MONDAY, []).isRecoveryWeek).toBe(true);
  });

  test('a descarga or a semana libre recovers nothing', () => {
    expect(touches(replanMissed(missedKey(LOAD_MONDAY)).changes, 'mon-thr')).toBe(true);
    const down = replanMissed({ ...missedKey(LOAD_MONDAY), weekPlan: plan(LOAD_MONDAY, 'recovery') });
    expect(down.changes).toEqual([]);
    expect(down.summary).toMatch(/Semana de descarga: no hace falta recuperar nada/);
    const free = replanMissed({ ...missedKey(LOAD_MONDAY), weekPlan: plan(LOAD_MONDAY, 'rest') });
    expect(free.changes).toEqual([]);
    expect(free.summary).toMatch(/Semana libre: no hace falta recuperar nada/);
  });

  test('"Carga" on a scheduled descarga recovers the missed key session', () => {
    const control = replanMissed(missedKey(DESCARGA_MONDAY));
    expect(control.changes).toEqual([]);
    expect(control.summary).toMatch(/Semana de descarga/);
    const load = replanMissed({ ...missedKey(DESCARGA_MONDAY), weekPlan: plan(DESCARGA_MONDAY, 'load') });
    expect(touches(load.changes, 'mon-thr')).toBe(true);
  });

  test('a plan for another week is ignored', () => {
    const other = replanMissed({ ...missedKey(LOAD_MONDAY), weekPlan: plan(DESCARGA_MONDAY, 'recovery') });
    expect(other).toEqual(replanMissed(missedKey(LOAD_MONDAY)));
  });
});
