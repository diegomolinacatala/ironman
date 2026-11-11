import { describe, expect, test } from '@jest/globals';

import { addDays } from '@/domain/dates';
import { phaseFor } from '@/domain/periodization';
import type { WeekPlan } from '@/domain/types';
import { makeBusy, makeEvent, makeProfile, makeRace, makeWorkout } from '@/features/workouts/__tests__/fixtures';

import {
  busyIntervalsOn,
  busySummary,
  eventsOn,
  hoursLabel,
  parsePlanView,
  parseWeekParam,
  recentWeeklyMinutes,
  weekPhaseOf,
  workoutsOnDay,
} from '../weekModel';

describe('busyIntervalsOn', () => {
  test('merges overlapping blocks and sorts them', () => {
    const blocks = [
      makeBusy('b2', [2026, 10, 27, 12, 0], [2026, 10, 27, 14, 0]),
      makeBusy('b1', [2026, 10, 27, 9, 0], [2026, 10, 27, 12, 30]),
      makeBusy('b3', [2026, 10, 27, 17, 0], [2026, 10, 27, 19, 0]),
    ];
    expect(busyIntervalsOn(blocks, '2026-10-27')).toEqual([
      { start: 9 * 60, end: 14 * 60 },
      { start: 17 * 60, end: 19 * 60 },
    ]);
  });

  test('clips multi-day blocks to the requested day', () => {
    const blocks = [makeBusy('trip', [2026, 10, 27, 20, 0], [2026, 10, 29, 8, 0])];
    expect(busyIntervalsOn(blocks, '2026-10-27')).toEqual([{ start: 20 * 60, end: 24 * 60 }]);
    expect(busyIntervalsOn(blocks, '2026-10-28')).toEqual([{ start: 0, end: 24 * 60 }]);
    expect(busyIntervalsOn(blocks, '2026-10-29')).toEqual([{ start: 0, end: 8 * 60 }]);
    expect(busyIntervalsOn(blocks, '2026-10-30')).toEqual([]);
  });

  test('ignores invalid or empty blocks', () => {
    const bad = { ...makeBusy('x', [2026, 10, 27, 9, 0], [2026, 10, 27, 9, 0]) };
    const garbage = { ...bad, id: 'y', start: 'nope' };
    expect(busyIntervalsOn([bad, garbage], '2026-10-27')).toEqual([]);
  });
});

describe('busySummary', () => {
  test('formats up to two ranges and counts the rest', () => {
    const blocks = [
      makeBusy('a', [2026, 10, 27, 9, 0], [2026, 10, 27, 10, 0]),
      makeBusy('b', [2026, 10, 27, 11, 0], [2026, 10, 27, 12, 0]),
      makeBusy('c', [2026, 10, 27, 16, 0], [2026, 10, 27, 17, 30]),
    ];
    expect(busySummary(blocks, '2026-10-27')).toBe('Ocupado 09:00–10:00 · 11:00–12:00 +1');
  });

  test('returns null on free days and a whole-day label when fully busy', () => {
    const blocks = [makeBusy('trip', [2026, 10, 27, 20, 0], [2026, 10, 29, 8, 0])];
    expect(busySummary(blocks, '2026-10-26')).toBeNull();
    expect(busySummary(blocks, '2026-10-28')).toBe('Ocupado todo el día');
  });
});

describe('eventsOn / workoutsOnDay', () => {
  test('includes events whose inclusive range covers the date', () => {
    const injury = makeEvent({ id: 'i', kind: 'injury', startDate: '2026-10-26', endDate: '2026-10-30' });
    const padel = makeEvent({ id: 'p' });
    expect(eventsOn([injury, padel], '2026-10-28').map((e) => e.id)).toEqual(['i', 'p']);
    expect(eventsOn([injury, padel], '2026-10-31')).toEqual([]);
  });

  test('sorts timed workouts first, then by creation', () => {
    const list = [
      makeWorkout({ id: 'late', date: '2026-10-27', startTime: '19:00' }),
      makeWorkout({ id: 'flex', date: '2026-10-27', startTime: null }),
      makeWorkout({ id: 'early', date: '2026-10-27', startTime: '07:00' }),
      makeWorkout({ id: 'other-day', date: '2026-10-28' }),
    ];
    expect(workoutsOnDay(list, '2026-10-27').map((w) => w.id)).toEqual(['early', 'late', 'flex']);
    expect(list[0]?.id).toBe('late');
  });
});

describe('recentWeeklyMinutes', () => {
  test('sums completed minutes per previous week, oldest first', () => {
    const list = [
      makeWorkout({ id: 'a', date: '2026-10-05', status: 'completed', completed: { durationMin: 60 } }),
      makeWorkout({ id: 'b', date: '2026-10-14', status: 'completed', completed: { durationMin: 50 } }),
      makeWorkout({ id: 'c', date: '2026-10-15', status: 'completed', durationMin: 40, completed: {} }),
      makeWorkout({ id: 'd', date: '2026-10-21', status: 'planned' }),
    ];
    expect(recentWeeklyMinutes(list, '2026-10-26', 4, addDays)).toEqual([0, 60, 90, 0]);
  });
});

describe('parseWeekParam / hoursLabel', () => {
  test('falls back on invalid params', () => {
    expect(parseWeekParam('2026-11-02', '2026-10-26')).toBe('2026-11-02');
    expect(parseWeekParam('next', '2026-10-26')).toBe('2026-10-26');
    expect(parseWeekParam(['2026-11-02'], '2026-10-26')).toBe('2026-10-26');
    expect(parseWeekParam(undefined, '2026-10-26')).toBe('2026-10-26');
  });

  test('formats hours with a decimal comma', () => {
    expect(hoursLabel(390)).toBe('6,5');
    expect(hoursLabel(120)).toBe('2');
    expect(hoursLabel(0)).toBe('0');
  });
});

describe('weekPhaseOf (Plan → General override in the week view)', () => {
  const MONDAY = '2026-11-09';
  const race = makeRace({ date: addDays(MONDAY, 7 * 20 + 6) });
  const profile = makeProfile();
  const plan = (overrides: Partial<WeekPlan> = {}): WeekPlan => ({
    weekStart: MONDAY,
    kind: 'recovery',
    targetMinutes: null,
    note: null,
    source: 'manual',
    updatedAt: '2026-11-09T08:00:00Z',
    ...overrides,
  });

  test('applies the week plan to the phase and the objective', () => {
    const recovery = weekPhaseOf(MONDAY, [race], profile, [plan(), plan({ weekStart: '2026-11-16', kind: 'push' })]);
    const push = weekPhaseOf(MONDAY, [race], profile, [plan({ kind: 'push' })]);
    expect(weekPhaseOf(MONDAY, [race], profile, []).plan).toBeNull();
    expect(recovery.plan?.kind).toBe('recovery');
    expect(recovery.phase?.isRecoveryWeek).toBe(true);
    expect(recovery.phase?.focus).toContain('descarga');
    expect(push.phase?.isRecoveryWeek).toBe(false);
    expect(push.phase?.focus).toContain('más volumen');
    expect(recovery.targetHours).toBeLessThan(push.targetHours ?? 0);
  });

  test('explicit hours win and the level reaches the periodization', () => {
    const week = weekPhaseOf(MONDAY, [race], profile, [plan({ kind: 'load', targetMinutes: 390 })]);
    expect(week.targetHours).toBe(6.5);
    const beginner = weekPhaseOf(MONDAY, [race], makeProfile({ level: 'beginner' }), []);
    expect(beginner.phase).toEqual(phaseFor(MONDAY, [race], { level: 'beginner' }));
  });

  test('ignores plans for weeks the race organises and waits for the races', () => {
    const raceWeek = startOfRaceWeek(race.date);
    const week = weekPhaseOf(raceWeek, [race], profile, [plan({ weekStart: raceWeek, kind: 'push' })]);
    expect(week.plan).toBeNull();
    expect(week.phase?.phase).toBe('race_week');
    expect(weekPhaseOf(MONDAY, undefined, profile, [plan()])).toEqual({ phase: null, plan: null, targetHours: 10 });
    expect(weekPhaseOf(MONDAY, [], null, []).targetHours).toBeNull();
  });

  test('only ?view=general leaves the week view', () => {
    expect(parsePlanView('general')).toBe('general');
    expect(parsePlanView(undefined)).toBe('week');
    expect(parsePlanView(['general'])).toBe('week');
  });
});

function startOfRaceWeek(date: string): string {
  return addDays(date, -6);
}
