import { describe, expect, test } from '@jest/globals';

import { addMinutes, busySegments, DEFAULT_FRIEND_WINDOWS, isTimedActive, myBusyIntervals, windowsOrDefault, workoutEnd } from '../intervals';

import { busyBlock, workout } from './fixtures';

const RANGE = { from: '2026-10-26', to: '2026-11-01' };

describe('addMinutes / workoutEnd', () => {
  test('adds and clamps to the same day', () => {
    expect(addMinutes('18:30', 75)).toBe('19:45');
    expect(addMinutes('23:30', 90)).toBe('23:59');
    expect(workoutEnd({ startTime: '07:00', durationMin: 45 })).toBe('07:45');
    expect(workoutEnd({ startTime: null, durationMin: 45 })).toBeNull();
  });
});

describe('busySegments', () => {
  test('keeps a same-day block as one segment with its title', () => {
    expect(busySegments([busyBlock()], RANGE)).toEqual([
      { key: 'b1:2026-10-27', date: '2026-10-27', start: '09:00', end: '14:00', title: 'Clase' },
    ]);
  });

  test('splits blocks across midnight and drops blocks outside the range', () => {
    const segments = busySegments(
      [
        busyBlock({ id: 'night', start: '2026-10-28T22:00:00', end: '2026-10-29T07:30:00' }),
        busyBlock({ id: 'out', start: '2026-11-05T10:00:00', end: '2026-11-05T11:00:00' }),
        busyBlock({ id: 'bad', start: 'nope', end: 'nope' }),
      ],
      RANGE,
    );
    expect(segments.map((s) => [s.date, s.start, s.end])).toEqual([
      ['2026-10-28', '22:00', '23:59'],
      ['2026-10-29', '00:00', '07:30'],
    ]);
  });
});

describe('myBusyIntervals', () => {
  test('combines busy segments and timed active workouts as local date-times', () => {
    const intervals = myBusyIntervals(busySegments([busyBlock()], RANGE), [
      workout({ startTime: '18:00', durationMin: 60 }),
      workout({ id: 'untimed', startTime: null }),
      workout({ id: 'skipped', status: 'skipped' }),
    ]);
    expect(intervals).toEqual([
      { start: '2026-10-27T09:00:00', end: '2026-10-27T14:00:00' },
      { start: '2026-10-27T18:00:00', end: '2026-10-27T19:00:00' },
    ]);
  });

  test('isTimedActive ignores rest days and zero durations', () => {
    expect(isTimedActive(workout({ sport: 'rest' }))).toBe(false);
    expect(isTimedActive(workout({ durationMin: 0 }))).toBe(false);
    expect(isTimedActive(workout())).toBe(true);
  });
});

describe('windowsOrDefault', () => {
  test('falls back to 06:30–22:00 every day', () => {
    expect(windowsOrDefault([])).toHaveLength(7);
    expect(windowsOrDefault(null)[0]).toEqual({ weekday: 0, start: '06:30', end: '22:00' });
    const mine = [{ weekday: 1 as const, start: '19:00', end: '21:00' }];
    expect(windowsOrDefault(mine)).toEqual(mine);
    expect(windowsOrDefault(mine)).not.toBe(mine);
    expect(DEFAULT_FRIEND_WINDOWS.every((w) => w.start === '06:30' && w.end === '22:00')).toBe(true);
  });
});
