import { describe, expect, test } from '@jest/globals';

import type { Availability, TrainingWindow } from '@/domain/types';

import {
  DEFAULT_AVAILABILITY,
  WINDOW_PRESETS,
  customWindows,
  fillWindowsForAllDays,
  formatHours,
  hasWindow,
  normalizeAvailability,
  removeWindow,
  setRestDay,
  toggleWeekday,
  toggleWindow,
  windowsCapacityMinutes,
} from '../availabilityModel';

const [morning, midday, evening] = WINDOW_PRESETS;

describe('availabilityModel', () => {
  test('toggleWindow adds a preset window and keeps windows sorted', () => {
    const start: TrainingWindow[] = [{ weekday: 3, start: '19:00', end: '21:00' }];
    const next = toggleWindow(start, 1, morning!);
    expect(next).toEqual([
      { weekday: 1, start: '07:00', end: '08:30' },
      { weekday: 3, start: '19:00', end: '21:00' },
    ]);
    expect(start).toHaveLength(1);
  });

  test('toggleWindow removes an existing preset window', () => {
    const start = toggleWindow([], 2, evening!);
    expect(hasWindow(start, 2, evening!)).toBe(true);
    const next = toggleWindow(start, 2, evening!);
    expect(next).toEqual([]);
    expect(hasWindow(next, 2, evening!)).toBe(false);
  });

  test('customWindows returns only windows not matching presets', () => {
    const windows: TrainingWindow[] = [
      { weekday: 0, start: '07:00', end: '08:30' },
      { weekday: 0, start: '06:00', end: '06:45' },
    ];
    expect(customWindows(windows)).toEqual([{ weekday: 0, start: '06:00', end: '06:45' }]);
  });

  test('removeWindow drops only the exact window', () => {
    const windows: TrainingWindow[] = [
      { weekday: 5, start: '08:00', end: '13:00' },
      { weekday: 6, start: '08:00', end: '13:00' },
    ];
    expect(removeWindow(windows, { weekday: 5, start: '08:00', end: '13:00' })).toEqual([windows[1]]);
    expect(windows).toHaveLength(2);
  });

  test('fillWindowsForAllDays sets the preset on every given weekday without duplicates', () => {
    const start = toggleWindow([], 4, midday!);
    const next = fillWindowsForAllDays(start, midday!, [0, 4]);
    expect(next).toEqual([
      { weekday: 0, start: '14:00', end: '15:30' },
      { weekday: 4, start: '14:00', end: '15:30' },
    ]);
  });

  test('toggleWeekday adds sorted and removes', () => {
    expect(toggleWeekday([6], 2)).toEqual([2, 6]);
    expect(toggleWeekday([2, 6], 6)).toEqual([2]);
  });

  test('windowsCapacityMinutes sums window lengths', () => {
    const windows = [...toggleWindow([], 0, morning!), ...toggleWindow([], 1, evening!)];
    expect(windowsCapacityMinutes(windows)).toBe(90 + 120);
  });

  test('formatHours uses decimal comma', () => {
    expect(formatHours(8)).toBe('8 h');
    expect(formatHours(7.5)).toBe('7,5 h');
  });

  test('normalizeAvailability fills missing fields and keeps explicit null rest day', () => {
    expect(normalizeAvailability(null)).toEqual(DEFAULT_AVAILABILITY);
    const partial: Partial<Availability> = { weeklyHoursTarget: 10, restDay: null };
    expect(normalizeAvailability(partial)).toEqual({ ...DEFAULT_AVAILABILITY, weeklyHoursTarget: 10, restDay: null });
  });

  test('setRestDay removes the rest day from long-session days', () => {
    const next = setRestDay({ ...DEFAULT_AVAILABILITY, longSessionDays: [5, 6] }, 6);
    expect(next.restDay).toBe(6);
    expect(next.longSessionDays).toEqual([5]);
    expect(setRestDay(next, null).longSessionDays).toEqual([5]);
  });
});
