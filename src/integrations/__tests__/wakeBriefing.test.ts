import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { Repository } from '@/data/repository';
import type { NotificationPrefs } from '@/domain/types';

import { buildMetricsDrafts, sleepWindowsByDate, type SleepSampleLike } from '../health/mapping';
import { handleSleepUpdate, type WakeBriefingDeps } from '../health/wakeBriefing';
import { useWakeBriefing, wantsWakeWatch } from '../effects/useWakeBriefing';
import { prefs as basePrefs } from './fixtures';

const mockWatchSleep = jest.fn((_onChange: () => void) => () => undefined);
const mockStopSleepWatch = jest.fn(async () => undefined);
let mockHealthOn = true;

jest.mock('../healthkit', () => ({
  isHealthEnabled: async () => mockHealthOn,
  requestHealthPermissions: async () => true,
  readLastNight: async () => null,
  syncHealth: async () => ({}),
}));
jest.mock('../health/sleepWatch', () => ({
  watchSleep: (onChange: () => void) => mockWatchSleep(onChange),
  stopSleepWatch: () => mockStopSleepWatch(),
}));
jest.mock('../notifications', () => ({ getNotificationPermission: async () => 'granted', scheduleWakeBriefing: async () => true }));

beforeEach(() => {
  jest.clearAllMocks();
  mockHealthOn = true;
});

const WAKE: NotificationPrefs = { ...basePrefs, morningSummary: true, morningMode: 'wake', wakeDelayMin: 15 };

/** Local time on 26 Nov 2026. */
const at = (h: number, m: number) => new Date(2026, 10, 26, h, m);

function deps(overrides: Partial<WakeBriefingDeps> = {}) {
  const calls = { claimed: [] as unknown[], scheduled: [] as [string, Date][], handled: [] as string[] };
  let handledDay: string | null = null;
  const d: WakeBriefingDeps = {
    readLastNight: async () => ({ start: at(0, 10).toISOString(), end: at(6, 50).toISOString() }),
    canNotify: async () => true,
    claim: async (input) => {
      calls.claimed.push(input);
      return true;
    },
    schedule: async (date, fireAt) => {
      calls.scheduled.push([date, fireAt]);
      return true;
    },
    handledDay: async () => handledDay,
    setHandledDay: async (date) => {
      handledDay = date;
      calls.handled.push(date);
    },
    now: () => at(6, 58),
    ...overrides,
  };
  return { d, calls };
}

describe('handleSleepUpdate (Apple Salud path of the wake-up briefing)', () => {
  test('claims today and schedules the briefing at wake-up + delay, once a day', async () => {
    const { d, calls } = deps();
    expect(await handleSleepUpdate(WAKE, d)).toBe('scheduled');
    expect(calls.claimed).toEqual([{ date: '2026-11-26', sleepEnd: at(6, 50).toISOString(), dueAt: at(7, 5).toISOString() }]);
    expect(calls.scheduled).toEqual([['2026-11-26', at(7, 5)]]);
    expect(await handleSleepUpdate(WAKE, d)).toBe('done_today');
    expect(calls.claimed).toHaveLength(1);
  });

  test('the server already sent (or another iPhone claimed): nothing scheduled here', async () => {
    const { d, calls } = deps({ claim: async () => false });
    expect(await handleSleepUpdate(WAKE, d)).toBe('taken');
    expect(calls.scheduled).toEqual([]);
    expect(calls.handled).toEqual(['2026-11-26']);
  });

  test('a failed claim (offline) is retried on the next update and schedules nothing', async () => {
    const { d, calls } = deps({ claim: async () => Promise.reject(new Error('offline')) });
    await expect(handleSleepUpdate(WAKE, d)).rejects.toThrow('offline');
    expect(calls.scheduled).toEqual([]);
    expect(calls.handled).toEqual([]);
  });

  test('does nothing in fixed mode, without last night, for a night of another day or without permission', async () => {
    expect(await handleSleepUpdate({ ...WAKE, morningMode: 'fixed' }, deps().d)).toBe('off');
    expect(await handleSleepUpdate({ ...WAKE, morningSummary: false }, deps().d)).toBe('off');
    expect(await handleSleepUpdate(WAKE, deps({ readLastNight: async () => null }).d)).toBe('no_night');
    const yesterday = deps({ readLastNight: async () => ({ start: new Date(2026, 10, 25, 0, 0).toISOString(), end: new Date(2026, 10, 25, 7, 0).toISOString() }) });
    expect(await handleSleepUpdate(WAKE, yesterday.d)).toBe('not_this_morning');
    const nap = deps({ readLastNight: async () => ({ start: at(1, 0).toISOString(), end: at(2, 0).toISOString() }) });
    expect(await handleSleepUpdate(WAKE, nap.d)).toBe('not_this_morning');
    const muted = deps({ canNotify: async () => false });
    expect(await handleSleepUpdate(WAKE, muted.d)).toBe('no_permission');
    expect(muted.calls.claimed).toEqual([]);
  });

  test('hours after the wake-up it is too late: settled without notifying', async () => {
    const { d, calls } = deps({ now: () => at(10, 10) });
    expect(await handleSleepUpdate(WAKE, d)).toBe('too_late');
    expect(calls.claimed).toEqual([]);
    expect(calls.handled).toEqual(['2026-11-26']);
  });

  test('the watch is only wanted in wake mode with a backend', () => {
    expect(wantsWakeWatch(null, true)).toBeNull();
    expect(wantsWakeWatch(WAKE, true)).toBe(true);
    expect(wantsWakeWatch(WAKE, false)).toBe(false);
    expect(wantsWakeWatch({ ...WAKE, morningMode: 'fixed' }, true)).toBe(false);
  });
});

describe('useWakeBriefing', () => {
  const server = { auth: {}, claimWakeBriefing: async () => true } as unknown as Repository;
  const demo = { auth: {} } as unknown as Repository;

  test('wake mode + Apple Salud + a backend: watches sleep (also in the background)', async () => {
    await renderHook(() => useWakeBriefing(true, server, 'user-ana', WAKE));
    await waitFor(() => expect(mockWatchSleep).toHaveBeenCalledTimes(1));
    expect(mockStopSleepWatch).not.toHaveBeenCalled();
  });

  test('fixed mode, Apple Salud off or no backend: background delivery off', async () => {
    await renderHook(() => useWakeBriefing(true, server, 'user-ana', { ...WAKE, morningMode: 'fixed' }));
    await waitFor(() => expect(mockStopSleepWatch).toHaveBeenCalledTimes(1));
    mockHealthOn = false;
    await renderHook(() => useWakeBriefing(true, server, 'user-ana', WAKE));
    await waitFor(() => expect(mockStopSleepWatch).toHaveBeenCalledTimes(2));
    await renderHook(() => useWakeBriefing(true, demo, 'user-ana', WAKE));
    await waitFor(() => expect(mockStopSleepWatch).toHaveBeenCalledTimes(3));
    expect(mockWatchSleep).not.toHaveBeenCalled();
  });

  test('nothing while the profile loads or signed out (a background launch must not drop the observer)', async () => {
    await renderHook(() => useWakeBriefing(true, server, 'user-ana', null));
    await renderHook(() => useWakeBriefing(false, server, null, WAKE));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockWatchSleep).not.toHaveBeenCalled();
    expect(mockStopSleepWatch).not.toHaveBeenCalled();
  });
});

describe('sleepWindowsByDate', () => {
  const sample = (start: Date, end: Date, value = 3): SleepSampleLike => ({ startDate: start, endDate: end, value });

  test('the main night with its awakenings; an afternoon nap does not move the wake-up', () => {
    const samples = [
      sample(new Date(2026, 10, 25, 23, 30), new Date(2026, 10, 26, 2, 0)),
      sample(new Date(2026, 10, 26, 2, 20), new Date(2026, 10, 26, 6, 50), 4),
      sample(new Date(2026, 10, 26, 6, 50), new Date(2026, 10, 26, 7, 0), 2), // awake: ignored
      sample(new Date(2026, 10, 26, 15, 0), new Date(2026, 10, 26, 15, 40)), // nap
    ];
    expect(sleepWindowsByDate(samples)).toEqual({
      '2026-11-26': { start: new Date(2026, 10, 25, 23, 30).toISOString(), end: new Date(2026, 10, 26, 6, 50).toISOString() },
    });
  });

  test('metrics drafts carry the night start and end for the server', () => {
    const [draft] = buildMetricsDrafts(['2026-11-26'], {
      sleepHours: { '2026-11-26': 7.2 },
      restingHr: {},
      hrvMs: {},
      steps: {},
      vo2max: {},
      sleepWindows: { '2026-11-26': { start: '2026-11-25T22:30:00.000Z', end: '2026-11-26T05:50:00.000Z' } },
    });
    expect(draft).toMatchObject({ sleepHours: 7.2, sleepStart: '2026-11-25T22:30:00.000Z', sleepEnd: '2026-11-26T05:50:00.000Z' });
  });
});
