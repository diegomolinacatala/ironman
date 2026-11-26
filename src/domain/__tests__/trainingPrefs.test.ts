/** «Tu forma de entrenar»: parsing, the summary line and how the rules planner honours it. */
import { addDays, weekdayOf } from '../dates';
import { planWeek, type PlannerInput } from '../planner';
import { lowIntensityShare } from '../plannerSupport';
import { specClass, specSport } from '../sessions';
import {
  DEFAULT_TRAINING_PREFS,
  isDefaultTrainingPrefs,
  lowIntensityShareFor,
  parseTrainingPrefs,
  trainingPrefsSentence,
  trainingPrefsSummary,
} from '../trainingPrefs';
import type { Availability, TrainingPrefs, WorkoutDraft } from '../types';
import { makeProfile, makeRace, makeWorkout } from './fixtures';

const AUTO: Availability = { mode: 'auto', weeklyHoursTarget: 0, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };
/** Base load week towards a 70.3 in June. */
const WEEK = '2026-11-30';
/** Build week of an olympic in March (quality sessions at the top of the zones). */
const BUILD_WEEK = '2027-02-22';

function prefs(overrides: Partial<TrainingPrefs> = {}): TrainingPrefs {
  return { ...DEFAULT_TRAINING_PREFS, ...overrides };
}

function input(trainingPrefs: TrainingPrefs | null, overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: WEEK,
    profile: makeProfile({ availability: AUTO, trainingPrefs }),
    races: [makeRace({ date: '2027-06-13', distance: 'half' })],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    recentWeeklyMinutes: [480, 480, 480, 480],
    ...overrides,
  };
}

function adds(result: ReturnType<typeof planWeek>): WorkoutDraft[] {
  return result.changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

describe('trainingPrefs (pure)', () => {
  test('empty or missing = automático', () => {
    expect(parseTrainingPrefs(null)).toBeNull();
    expect(parseTrainingPrefs('x')).toBeNull();
    expect(parseTrainingPrefs({})).toEqual(DEFAULT_TRAINING_PREFS);
    expect(isDefaultTrainingPrefs(null)).toBe(true);
    expect(isDefaultTrainingPrefs(DEFAULT_TRAINING_PREFS)).toBe(true);
    expect(trainingPrefsSummary(DEFAULT_TRAINING_PREFS)).toBeNull();
    expect(trainingPrefsSentence(null)).toBeNull();
    expect(lowIntensityShareFor(null)).toBe(0.75);
  });

  test('one line with the choices', () => {
    const p = prefs({
      preferredDays: { swim: [0, 2] },
      longRideDays: [5],
      longRunDays: [6],
      sessionsPerWeek: { run: 3, strength: 0 },
      intensityModel: 'polarized',
      fixedSessions: [{ sport: 'swim', weekday: 1, startTime: '20:00', durationMin: 60, title: 'Natación del club' }],
    });
    expect(isDefaultTrainingPrefs(p)).toBe(false);
    expect(trainingPrefsSummary(p)).toBe('piscina L y X, larga S, tirada larga D, 3 de carrera, sin fuerza, polarizado 80/20, natación del club M 20:00');
    expect(trainingPrefsSentence(prefs({ preferredDays: { swim: [0, 2] }, longRideDays: [5] }))).toBe('Según tu forma de entrenar: piscina L y X, larga S.');
    expect(lowIntensityShareFor(prefs({ intensityModel: 'polarized' }))).toBe(0.8);
    expect(lowIntensityShareFor(prefs({ intensityModel: 'pyramidal' }))).toBe(0.7);
  });
});

describe('the planner honours «Tu forma de entrenar»', () => {
  test('automático plans exactly as before', () => {
    expect(planWeek(input(prefs())).changes).toEqual(planWeek(input(null)).changes);
  });

  test('preferred swim days, long ride and long run days', () => {
    const result = planWeek(input(prefs({ preferredDays: { swim: [0, 2] }, longRideDays: [6], longRunDays: [5] })));
    const swims = result.placed.filter((p) => specSport(p.spec) === 'swim');
    expect(swims.length).toBeGreaterThan(0);
    for (const s of swims) expect([0, 2]).toContain(weekdayOf(s.date));
    const longRide = result.placed.find((p) => p.spec.code === 'BK_LONG' || p.spec.code === 'BRICK');
    const longRun = result.placed.find((p) => p.spec.code === 'RN_LONG');
    expect(weekdayOf(longRide?.date ?? WEEK)).toBe(6);
    expect(weekdayOf(longRun?.date ?? WEEK)).toBe(5);
    expect(result.summary).toContain('Según tu forma de entrenar: piscina L y X, larga D, tirada larga S.');
  });

  test('sessions per sport within the week, never below the minimum length', () => {
    const result = planWeek(input(prefs({ sessionsPerWeek: { run: 4, swim: 0, strength: 0 } })));
    const runs = result.placed.filter((p) => specSport(p.spec) === 'run');
    expect(runs.length).toBe(4);
    for (const r of runs) expect(r.spec.durationMin).toBeGreaterThanOrEqual(25);
    expect(result.placed.some((p) => specSport(p.spec) === 'swim' || specSport(p.spec) === 'strength')).toBe(false);
    expect(result.placed.reduce((s, p) => s + p.spec.durationMin, 0)).toBeLessThanOrEqual(result.targetMinutes);
  });

  test('a fixed weekly session appears as a new workout and the week is planned around it', () => {
    const club = { sport: 'swim' as const, weekday: 1 as const, startTime: '20:00', durationMin: 60, title: 'Natación del club' };
    const result = planWeek(input(prefs({ fixedSessions: [club] })));
    const drafts = adds(result);
    const fixed = drafts.filter((d) => d.title === 'Natación del club');
    expect(fixed).toEqual([expect.objectContaining({ date: addDays(WEEK, 1), startTime: '20:00', sport: 'swim', durationMin: 60, intensity: 'endurance' })]);
    // No second swim on Tuesday, and the club swim counts in the week's swimming.
    expect(drafts.filter((d) => d.sport === 'swim' && d.date === addDays(WEEK, 1))).toHaveLength(1);
    const plain = planWeek(input(null));
    expect(result.placed.filter((p) => specSport(p.spec) === 'swim').length).toBeLessThan(plain.placed.filter((p) => specSport(p.spec) === 'swim').length);
    // Already in the calendar that day: not added twice.
    const again = planWeek(input(prefs({ fixedSessions: [club] }), { existing: [makeWorkout({ date: addDays(WEEK, 1), sport: 'swim', title: 'Club', startTime: '20:00', durationMin: 60 })] }));
    expect(adds(again).some((d) => d.title === 'Natación del club')).toBe(false);
  });

  test('polarizado: no middle zone and at least 80 % easy', () => {
    const result = planWeek(input(prefs({ intensityModel: 'polarized' })));
    expect(result.placed.some((p) => ['BK_TEMPO', 'BK_SST', 'RN_TEMPO'].includes(p.spec.code))).toBe(false);
    expect(lowIntensityShare(result.placed.map((p) => p.spec))).toBeGreaterThanOrEqual(0.8);
  });

  test('piramidal: tempo instead of threshold in build', () => {
    const build = { weekStart: BUILD_WEEK, races: [makeRace({ date: '2027-03-21', distance: 'olympic' })] };
    const auto = planWeek(input(null, build));
    const pyramidal = planWeek(input(prefs({ intensityModel: 'pyramidal' }), build));
    expect(auto.placed.some((p) => ['BK_THR', 'RN_THR', 'BK_VO2', 'RN_VO2'].includes(p.spec.code))).toBe(true);
    expect(pyramidal.placed.some((p) => ['BK_THR', 'RN_THR', 'BK_VO2', 'RN_VO2'].includes(p.spec.code))).toBe(false);
    expect(pyramidal.placed.some((p) => specClass(p.spec) === 'QUALITY')).toBe(true);
  });
});
