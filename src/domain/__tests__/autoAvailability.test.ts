import { isAutoAvailability, normalWeekHours, planningAvailability } from '../availability';
import { addDays, timeToMinutes, weekdayOf } from '../dates';
import { AUTO_DAY_MAX_MIN, planWeek, type PlannerInput } from '../planner';
import { phaseFor } from '../periodization';
import { rampCapMinutes } from '../plannerSupport';
import { autoWeeklyHours, autoWeeklyMinutes, buildSeason, manualWeeklyHours, weeklyHoursFor, weeklyTargetMinutes } from '../season';
import { busyRangesOn } from '../timeRanges';
import type { Availability, BusyBlock, PlanChange, WorkoutDraft } from '../types';
import { makeBusy, makeProfile, makeRace, NEXT_MONDAY } from './fixtures';

const AUTO: Availability = { mode: 'auto', weeklyHoursTarget: 3, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };

function adds(changes: PlanChange[]): WorkoutDraft[] {
  return changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

function autoInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: NEXT_MONDAY,
    profile: makeProfile({ availability: AUTO }),
    races: [makeRace()],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    ...overrides,
  };
}

/** Busy from `from` to `to` on every day of the week. */
function everyDay(from: string, to: string): BusyBlock[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => makeBusy(`${addDays(NEXT_MONDAY, i)}T${from}:00`, `${addDays(NEXT_MONDAY, i)}T${to}:00`));
}

describe('automatic weekly hours (season.ts)', () => {
  test('ambitious but sensible table: more for longer races and higher levels', () => {
    expect(autoWeeklyHours('intermediate', 'full')).toBe(15);
    expect(autoWeeklyHours('advanced', 'full')).toBeGreaterThan(autoWeeklyHours('intermediate', 'full'));
    expect(autoWeeklyHours('beginner', 'sprint')).toBeLessThan(autoWeeklyHours('beginner', 'half'));
    expect(autoWeeklyHours(undefined, null)).toBe(autoWeeklyHours('intermediate', null));
    expect(autoWeeklyMinutes('intermediate', 'half', 0.5)).toBe(360);
  });

  test('manual hours only with mode manual; absent mode = automatic', () => {
    expect(manualWeeklyHours({ weeklyHoursTarget: 8 })).toBeNull();
    expect(manualWeeklyHours({ mode: 'auto', weeklyHoursTarget: 8 })).toBeNull();
    expect(manualWeeklyHours({ mode: 'manual', weeklyHoursTarget: 8 })).toBe(8);
    expect(manualWeeklyHours({ mode: 'manual', weeklyHoursTarget: Number.NaN })).toBeNull();
    expect(weeklyHoursFor(null, 'advanced', 'half')).toBe(15);
    expect(weeklyHoursFor(6, 'advanced', 'half')).toBe(6);
  });

  test('the season uses the automatic hours of each week when there are no manual hours', () => {
    const race = makeRace();
    const season = buildSeason({ today: NEXT_MONDAY, races: [race], level: 'intermediate', weeklyHoursTarget: null });
    const manual = buildSeason({ today: NEXT_MONDAY, races: [race], level: 'intermediate', weeklyHoursTarget: 8 });
    const first = season.weeks[0];
    expect(first?.targetMinutes).toBe(weeklyTargetMinutes(null, 'intermediate', { volumeFactor: first?.volumeFactor ?? 0, targetRace: race }));
    expect(first?.targetMinutes).toBe(Math.round((12 * 60 * (first?.volumeFactor ?? 0)) / 5) * 5);
    expect(first?.targetMinutes ?? 0).toBeGreaterThan(manual.weeks[0]?.targetMinutes ?? 0);
  });
});

describe('availability modes', () => {
  test('automatic drops the fixed rest day and the windows; manual is untouched', () => {
    const legacy: Availability = { weeklyHoursTarget: 8, restDay: 0, longSessionDays: [5, 6], windows: [{ weekday: 1, start: '07:00', end: '08:00' }], poolDays: [2] };
    expect(isAutoAvailability(legacy)).toBe(true);
    expect(planningAvailability(legacy)).toEqual({ ...legacy, mode: 'auto', restDay: null, windows: [] });
    const manual: Availability = { ...legacy, mode: 'manual' };
    expect(planningAvailability(manual)).toBe(manual);
    expect(normalWeekHours(manual, 'advanced', 'full')).toBe(8);
    expect(normalWeekHours(legacy, 'advanced', 'full')).toBe(18);
  });
});

describe('planner with automatic availability', () => {
  test('aims for the automatic hours, not the stored ones', () => {
    const result = planWeek(autoInput());
    const phase = phaseFor(NEXT_MONDAY, [makeRace()], { level: 'intermediate' });
    expect(result.targetMinutes).toBe(Math.round(12 * 60 * phase.volumeFactor));
    const manual = planWeek(autoInput({ profile: makeProfile({ availability: { ...AUTO, mode: 'manual' } }) }));
    expect(result.addedMinutes).toBeGreaterThan(manual.addedMinutes);
  });

  test('every session gets a real start time in a free gap of the calendar', () => {
    const busy = [0, 1, 2, 3, 4].map((i) => makeBusy(`${addDays(NEXT_MONDAY, i)}T09:00:00`, `${addDays(NEXT_MONDAY, i)}T17:30:00`));
    const drafts = adds(planWeek(autoInput({ busyBlocks: busy })).changes).filter((w) => w.sport !== 'rest');
    expect(drafts.length).toBeGreaterThan(4);
    for (const w of drafts) {
      expect(w.startTime).not.toBeNull();
      const start = timeToMinutes(w.startTime ?? '');
      expect(start).toBeGreaterThanOrEqual(7 * 60);
      expect(start + w.durationMin).toBeLessThanOrEqual(22 * 60);
      for (const r of busyRangesOn(w.date, busy)) expect(start + w.durationMin <= r.start || start >= r.end).toBe(true);
    }
    // Weekend (long sessions): in the morning.
    const weekendLong = drafts.filter((w) => weekdayOf(w.date) >= 5);
    expect(weekendLong.length).toBeGreaterThan(0);
    for (const w of weekendLong) expect(timeToMinutes(w.startTime ?? '')).toBeLessThan(10 * 60);
  });

  test('no fixed rest day: the rest falls on the day the calendar leaves no room', () => {
    const wednesday = addDays(NEXT_MONDAY, 2);
    const result = planWeek(autoInput({ busyBlocks: [makeBusy(`${wednesday}T06:00:00`, `${wednesday}T23:00:00`)] }));
    const drafts = adds(result.changes).filter((w) => w.sport !== 'rest');
    expect(drafts.some((w) => w.date === wednesday)).toBe(false);
    expect(drafts.some((w) => w.date === NEXT_MONDAY)).toBe(true);
    expect(result.summary).not.toMatch(/Lunes de descanso/);
  });

  test('never more than the free time of a full calendar', () => {
    const busy = everyDay('07:00', '21:00');
    // Full distance: the automatic target (15 h × factor) is more than the 7 × 60' left.
    const result = planWeek(autoInput({ busyBlocks: busy, races: [makeRace({ distance: 'full' })] }));
    expect(result.targetMinutes).toBeLessThanOrEqual(7 * Math.min(60, AUTO_DAY_MAX_MIN));
    expect(result.warnings.join(' ')).toMatch(/calendario va lleno/);
    expect(result.addedMinutes).toBeLessThanOrEqual(7 * 60);
  });

  test('the ramp cap still keeps the jump safe', () => {
    const recentWeeklyMinutes = [150, 150, 150, 150];
    const result = planWeek(autoInput({ recentWeeklyMinutes, races: [makeRace({ distance: 'full' })] }));
    const ramp = rampCapMinutes({ recentWeeklyMinutes, level: 'intermediate', lifeStress: false }) ?? 0;
    expect(result.targetMinutes).toBeLessThanOrEqual(ramp);
    expect(result.warnings.join(' ')).toMatch(/subir demasiado rápido/);
  });
});
