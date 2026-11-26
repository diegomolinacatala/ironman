/**
 * Short-notice ("survival") plans based on the athlete's real volume: a
 * non-beginner who already trains the base of the distance gets a short base
 * and build weeks; everyone else keeps the base-only survival plan.
 */
import { addDays } from '../dates';
import { fitnessWeeklyMinutes, phaseFor, type PhaseOptions } from '../periodization';
import { planWeek } from '../planner';
import { buildSeason, canOverride } from '../season';
import { makeProfile, makeRace } from './fixtures';

/** A full distance added 16 weeks before its race week (2026-11-23 → race week of 2027-03-08). */
const full = makeRace({ id: 'f16', name: 'Distancia completa de marzo', distance: 'full', date: '2027-03-14', createdAt: '2026-11-23T10:00:00' });
const MONDAYS = Array.from({ length: 16 }, (_, i) => addDays('2026-11-23', 7 * i));
/** About 11 h 30' a week: more than the base of a full distance (10 h). */
const TRAINED = [660, 690, 720, 700];

function phases(opts: PhaseOptions) {
  return MONDAYS.map((monday) => phaseFor(monday, [full], opts));
}

function count(list: ReturnType<typeof phases>, phase: string): number {
  return list.filter((w) => w.phase === phase).length;
}

describe('fitnessWeeklyMinutes', () => {
  test('average of the last 4 weeks; null with fewer than 2 weeks of training', () => {
    expect(fitnessWeeklyMinutes([100, 600, 600, 600, 600])).toBe(600);
    expect(fitnessWeeklyMinutes([0, 0, 600, 600])).toBe(300);
    expect(fitnessWeeklyMinutes([0, 0, 0, 600])).toBeNull();
    expect(fitnessWeeklyMinutes([])).toBeNull();
    expect(fitnessWeeklyMinutes(undefined)).toBeNull();
  });
});

describe('periodization of a full distance 16 weeks out', () => {
  test('an advanced athlete who already trains the base gets a short base and build weeks', () => {
    const weeks = phases({ level: 'advanced', recentWeeklyMinutes: TRAINED });
    expect(count(weeks, 'base')).toBe(5);
    expect(count(weeks, 'build')).toBe(9);
    expect(weeks.slice(-2).map((w) => w.phase)).toEqual(['taper', 'race_week']);
    expect(weeks[0]?.warnings.join(' ')).toMatch(/ya cubre la base/);
    expect(weeks[0]?.warnings.join(' ')).not.toMatch(/supervivencia/);
  });

  test('without that volume the survival plan is unchanged: 14 base weeks and no build', () => {
    const none = phases({ level: 'advanced' });
    expect(count(none, 'base')).toBe(14);
    expect(count(none, 'build')).toBe(0);
    expect(none[0]?.warnings.join(' ')).toMatch(/plan de supervivencia/);
    expect(phases({ level: 'advanced', recentWeeklyMinutes: [300, 320, 280, 310] })).toEqual(none);
    // One big week is not a history.
    expect(phases({ level: 'advanced', recentWeeklyMinutes: [0, 0, 0, 720] })).toEqual(none);
  });

  test('beginners are unchanged whatever their volume', () => {
    expect(phases({ level: 'beginner', recentWeeklyMinutes: TRAINED })).toEqual(phases({ level: 'beginner' }));
    expect(phases({ recentWeeklyMinutes: TRAINED })).toEqual(phases({}));
  });

  test('race and taper weeks stay where the survival plan has them, so the same weeks take a week plan', () => {
    const ready = phases({ level: 'advanced', recentWeeklyMinutes: TRAINED });
    const survival = phases({ level: 'advanced' });
    expect(ready.map(canOverride)).toEqual(survival.map(canOverride));
  });

  test('plans with enough weeks do not change', () => {
    const later = makeRace({ id: 'f30', distance: 'full', date: '2027-06-20', createdAt: '2026-11-23T10:00:00' });
    const at = (opts: PhaseOptions) => MONDAYS.map((monday) => phaseFor(monday, [later], opts));
    expect(at({ level: 'advanced', recentWeeklyMinutes: TRAINED })).toEqual(at({ level: 'advanced' }));
  });
});

describe('Plan → General and the weekly planner see the same weeks', () => {
  test('buildSeason with the recent volume shows the build block', () => {
    const input = { today: '2026-11-23', races: [full], level: 'advanced' as const, weeklyHoursTarget: null };
    const ready = buildSeason({ ...input, recentWeeklyMinutes: TRAINED });
    const survival = buildSeason(input);
    expect(ready.weeks.map((w) => w.phaseLabel)).toContain('Construcción 1');
    expect(survival.weeks.some((w) => w.phase === 'build')).toBe(false);
    expect(ready.weeks.map((w) => w.editable)).toEqual(survival.weeks.map((w) => w.editable));
  });

  test('the planner takes the athlete volume (fitnessWeeklyMinutes, else recentWeeklyMinutes)', () => {
    const profile = makeProfile({ level: 'advanced' });
    const base = { weekStart: '2027-01-11', profile, races: [full], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [] };
    expect(planWeek(base).phase.phase).toBe('base');
    expect(planWeek({ ...base, fitnessWeeklyMinutes: TRAINED }).phase.phase).toBe('build');
    expect(planWeek({ ...base, recentWeeklyMinutes: TRAINED }).phase.phase).toBe('build');
  });
});
