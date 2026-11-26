/** «Tu contexto»: parsing, the planner hints, the words for the coach and how the rules planner uses it. */
import {
  EMPTY_ATHLETE_CONTEXT,
  athleteContextPlanSentence,
  athleteContextSummary,
  focusedSessionCount,
  hasAthleteContext,
  lifeLoadFactor,
  mealRanges,
  parseAthleteContext,
  periodRange,
  preferredTrainingTime,
  sportFocus,
  wakingDayOn,
} from '../athleteContext';
import { timeToMinutes } from '../dates';
import { planWeek, type PlannerInput } from '../planner';
import { specClass, specSport } from '../sessions';
import type { AthleteContext, Availability } from '../types';
import { athleteContextSchema } from '../validation';
import { makeProfile, makeRace } from './fixtures';

const AUTO: Availability = { mode: 'auto', weeklyHoursTarget: 0, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };
/** Base load week towards a 70.3 in June. */
const WEEK = '2026-11-30';

function context(overrides: Partial<AthleteContext> = {}): AthleteContext {
  return { ...EMPTY_ATHLETE_CONTEXT, ...overrides, habits: { ...EMPTY_ATHLETE_CONTEXT.habits, ...overrides.habits } };
}

function input(athleteContext: AthleteContext | null, overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: WEEK,
    profile: makeProfile({ availability: AUTO, athleteContext }),
    races: [makeRace({ date: '2027-06-13', distance: 'half' })],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    recentWeeklyMinutes: [480, 480, 480, 480],
    ...overrides,
  };
}

const swims = (r: ReturnType<typeof planWeek>) => r.placed.filter((p) => specSport(p.spec) === 'swim');
const minutesOf = (list: { spec: { durationMin: number } }[]) => list.reduce((s, p) => s + p.spec.durationMin, 0);

describe('athleteContext (pure)', () => {
  test('missing or odd values are dropped, the empty context is valid for zod', () => {
    expect(parseAthleteContext(null)).toBeNull();
    expect(parseAthleteContext([1])).toBeNull();
    expect(parseAthleteContext({})).toEqual(EMPTY_ATHLETE_CONTEXT);
    const parsed = parseAthleteContext({
      sports: { swim: { background: 'lifelong', goal: 'maintain' }, bike: { background: 'pro' }, tennis: { goal: 'maintain' } },
      occupation: 'both',
      load: 'extreme',
      periods: [
        { kind: 'exams', from: '2027-01-12', to: '2027-01-30', label: 'Exámenes de enero', eventId: 'e1' },
        { kind: 'exams', from: '2027-02-10', to: '2027-02-01', label: 'al revés' },
        { kind: 'party', from: '2027-02-10', to: '2027-02-11' },
      ],
      habits: { lunch: '14:00:00', dinner: '25:00', weekendWake: '09:30', weekendsDiffer: false, preferredTime: 'evening' },
      notes: ['  Tengo dos hijos  ', 'Tengo dos hijos', 42],
    });
    expect(parsed?.sports).toEqual({ swim: { background: 'lifelong', goal: 'maintain' } });
    expect(parsed?.occupation).toBe('both');
    expect(parsed?.load).toBeNull();
    expect(parsed?.periods).toEqual([{ kind: 'exams', from: '2027-01-12', to: '2027-01-30', label: 'Exámenes de enero', eventId: 'e1' }]);
    expect(parsed?.habits).toMatchObject({ lunch: '14:00', dinner: null, weekendWake: null, preferredTime: 'evening' });
    expect(parsed?.notes).toEqual(['Tengo dos hijos']);
    expect(athleteContextSchema.safeParse(EMPTY_ATHLETE_CONTEXT).success).toBe(true);
    expect(athleteContextSchema.safeParse(parsed).success).toBe(true);
    expect(hasAthleteContext(EMPTY_ATHLETE_CONTEXT)).toBe(false);
    expect(hasAthleteContext(parsed)).toBe(true);
  });

  test('sport focus: keep a lifelong sport, push one to improve a lot or a new swimmer', () => {
    const ctx = context({
      sports: {
        swim: { background: 'lifelong', goal: 'maintain' },
        bike: { background: 'some', goal: 'improve' },
        run: { background: 'some', goal: 'improve_lot' },
      },
    });
    expect(sportFocus(ctx)).toEqual({ swim: 'less', run: 'more' });
    expect(sportFocus(context({ sports: { swim: { background: 'new', goal: 'improve' } } }))).toEqual({ swim: 'more' });
    // «Mantener» without a background is not a reason to swim less.
    expect(sportFocus(context({ sports: { swim: { background: 'new', goal: 'maintain' } } }))).toEqual({});
    expect(focusedSessionCount(2, 'less')).toBe(1);
    expect(focusedSessionCount(1, 'less')).toBe(1);
    expect(focusedSessionCount(5, 'more')).toBe(5);
    expect(focusedSessionCount(3, null)).toBe(3);
  });

  test('studies/work load lowers the automatic hours (never below 85 %)', () => {
    expect(lifeLoadFactor(null)).toBe(1);
    expect(lifeLoadFactor(context({ occupation: 'work', load: 'light' }))).toBe(1);
    expect(lifeLoadFactor(context({ occupation: 'work', load: 'medium' }))).toBe(0.95);
    expect(lifeLoadFactor(context({ occupation: 'study', load: 'high' }))).toBe(0.88);
    expect(lifeLoadFactor(context({ occupation: 'both', load: 'high' }))).toBe(0.85);
    expect(lifeLoadFactor(context({ occupation: 'none', load: 'high' }))).toBe(1);
  });

  test('waking day from wake-up and bed times, weekends apart; meals as ranges', () => {
    const ctx = context({ habits: { ...EMPTY_ATHLETE_CONTEXT.habits, wake: '06:00', bed: '23:30', weekendsDiffer: true, weekendWake: '09:00', weekendBed: '00:30' } });
    expect(wakingDayOn(ctx, 0)).toEqual({ start: '06:30', end: '22:30' });
    expect(wakingDayOn(ctx, 6)).toEqual({ start: '09:30', end: '23:30' });
    expect(wakingDayOn(EMPTY_ATHLETE_CONTEXT, 0)).toBeNull();
    const meals = mealRanges(context({ habits: { ...EMPTY_ATHLETE_CONTEXT.habits, breakfast: '07:30', lunch: '14:00' } }));
    expect(meals).toEqual([
      { start: 450, end: 480 },
      { start: 840, end: 915 },
    ]);
    expect(preferredTrainingTime(context({ habits: { ...EMPTY_ATHLETE_CONTEXT.habits, preferredTime: 'any' } }))).toBeNull();
  });

  test('one line for the coach and the plan note', () => {
    const ctx = context({
      sports: { swim: { background: 'lifelong', goal: 'maintain' } },
      occupation: 'both',
      load: 'high',
      schedule: 'morning',
      periods: [{ kind: 'exams', from: '2027-01-12', to: '2027-01-30', label: 'Exámenes', eventId: null }],
      habits: { ...EMPTY_ATHLETE_CONTEXT.habits, lunch: '14:00', preferredTime: 'morning' },
      limitations: 'Rodilla derecha',
    });
    expect(periodRange({ from: '2026-12-28', to: '2027-01-10' })).toBe('28 dic-10 ene');
    expect(athleteContextSummary(ctx)).toBe(
      'natación: desde pequeño, quiere mantener · estudia y trabaja (carga alta, de mañana) · exámenes 12-30 ene · come 14:00 · prefiere entrenar por la mañana · lesiones o límites: Rodilla derecha',
    );
    expect(athleteContextSummary(ctx, '2027-02-01')).not.toContain('exámenes');
    expect(athleteContextSummary(EMPTY_ATHLETE_CONTEXT)).toBeNull();
    expect(athleteContextPlanSentence(ctx, { volumeApplied: true })).toBe(
      'Según tu contexto: natación para mantener, estudios y trabajo con carga alta (un 15 % menos de horas por defecto), sin entrenar justo después de comer y mejor por la mañana.',
    );
    expect(athleteContextPlanSentence(EMPTY_ATHLETE_CONTEXT, { volumeApplied: false })).toBeNull();
  });
});

describe('athleteContext in the rules planner', () => {
  test('nothing told = the same week', () => {
    expect(planWeek(input(EMPTY_ATHLETE_CONTEXT)).changes).toEqual(planWeek(input(null)).changes);
  });

  test('a lifelong swimmer who only wants to keep it swims less often; one who must improve swims more', () => {
    const plain = planWeek(input(null));
    const keep = planWeek(input(context({ sports: { swim: { background: 'lifelong', goal: 'maintain' } } })));
    const improve = planWeek(input(context({ sports: { swim: { background: 'some', goal: 'improve_lot' } } })));
    expect(swims(keep).length).toBeLessThan(swims(plain).length);
    expect(swims(improve).length).toBeGreaterThan(swims(plain).length);
    expect(minutesOf(swims(keep))).toBeLessThan(minutesOf(swims(improve)));
    expect(keep.summary).toContain('Según tu contexto: natación para mantener.');
  });

  test('«Tu forma de entrenar» wins: an explicit swim count is kept', () => {
    const profile = makeProfile({
      availability: AUTO,
      athleteContext: context({ sports: { swim: { background: 'lifelong', goal: 'maintain' } } }),
      trainingPrefs: { sessionsPerWeek: { swim: 3 }, preferredDays: {}, longRideDays: [], longRunDays: [], intensityModel: 'auto', fixedSessions: [] },
    });
    expect(swims(planWeek(input(null, { profile }))).length).toBe(3);
  });

  test('heavy studies and work lower the automatic week', () => {
    const plain = planWeek(input(null, { recentWeeklyMinutes: [] }));
    const busy = planWeek(input(context({ occupation: 'both', load: 'high' }), { recentWeeklyMinutes: [] }));
    expect(busy.targetMinutes).toBeLessThan(plain.targetMinutes);
    expect(busy.summary).toContain('estudios y trabajo con carga alta');
    // The athlete's own hours (manual availability) stay as set.
    const manual: Availability = { mode: 'manual', weeklyHoursTarget: 8, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] };
    const own = (ctx: AthleteContext | null) => planWeek(input(null, { recentWeeklyMinutes: [], profile: makeProfile({ availability: manual, athleteContext: ctx }) }));
    expect(own(context({ occupation: 'both', load: 'high' })).targetMinutes).toBe(own(null).targetMinutes);
  });

  test('no session right after lunch or dinner, inside the waking day, at the preferred time', () => {
    const ctx = context({ habits: { ...EMPTY_ATHLETE_CONTEXT.habits, wake: '06:00', bed: '23:00', lunch: '14:00', dinner: '21:00', preferredTime: 'evening' } });
    const result = planWeek(input(ctx));
    expect(result.placed.length).toBeGreaterThan(0);
    for (const p of result.placed) {
      if (!p.startTime) continue;
      const start = timeToMinutes(p.startTime);
      const end = start + p.spec.durationMin;
      expect(start).toBeGreaterThanOrEqual(6 * 60 + 30);
      expect(end).toBeLessThanOrEqual(22 * 60);
      for (const meal of [14 * 60, 21 * 60]) expect(start >= meal + 75 || end <= meal).toBe(true);
    }
    const short = result.placed.filter((p) => specClass(p.spec) !== 'LONG' && specClass(p.spec) !== 'BRICK' && p.startTime);
    expect(short.length).toBeGreaterThan(0);
    // Evening first: most short sessions start from 16:00 on.
    expect(short.filter((p) => (p.startTime ?? '') >= '16:00').length).toBeGreaterThan(short.length / 2);
  });
});
