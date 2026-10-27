/**
 * usePlanMirrors: widgets get today's briefing; the device calendar is synced (debounced)
 * for the signed-in account in the profile's time zone; nothing runs when not ready.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import type { Profile } from '@/domain/types';

import { CALENDAR_DEBOUNCE_MS, usePlanMirrors, type PlanSnapshot } from '../effects/usePlanMirrors';
import { prefs, workout } from './fixtures';

const mockSyncWidgets = jest.fn((_input: unknown) => undefined);
const mockReschedule = jest.fn(async (_input: unknown) => 0);
const mockSyncCalendar = jest.fn(async (_workouts: unknown, _today: unknown, _context: unknown) => ({ created: 0, updated: 0, deleted: 0 }));

jest.mock('../widgets/sync', () => ({ syncWidgets: (input: unknown) => mockSyncWidgets(input) }));
jest.mock('../notifications', () => ({ rescheduleLocalNotifications: (input: unknown) => mockReschedule(input) }));
jest.mock('../calendar/trainingCalendar', () => ({
  syncWorkoutsToCalendar: (workouts: unknown, today: unknown, context: unknown) => mockSyncCalendar(workouts, today, context),
}));

const profile = { id: 'user-ana', timezone: 'Europe/Madrid', notificationPrefs: prefs } as unknown as Profile;
const briefing = { date: '2026-10-27', headline: 'Hoy toca rodaje suave' };

function snapshot(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    workouts: [workout({ id: 'w1', date: '2026-10-27', userId: 'user-ana' })],
    races: [],
    jointSessions: [],
    profile,
    briefing,
    userId: 'user-ana',
    today: '2026-10-27',
    tick: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('usePlanMirrors', () => {
  test('mirrors the plan, the briefing headline and the calendar after the debounce', async () => {
    await renderHook(() => usePlanMirrors(true, snapshot()));
    expect(mockSyncCalendar).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(CALENDAR_DEBOUNCE_MS);
    });
    expect(mockSyncWidgets).toHaveBeenCalledWith(expect.objectContaining({ briefing, today: '2026-10-27' }));
    expect(mockSyncCalendar).toHaveBeenCalledTimes(1);
    expect(mockSyncCalendar).toHaveBeenCalledWith(expect.any(Array), '2026-10-27', { userId: 'user-ana', timeZone: 'Europe/Madrid' });
  });

  test('a burst of plan changes syncs the calendar once', async () => {
    const { rerender } = await renderHook((props: PlanSnapshot) => usePlanMirrors(true, props), { initialProps: snapshot() });
    await rerender(snapshot({ workouts: [workout({ id: 'w2', date: '2026-10-28' })] }));
    await rerender(snapshot({ workouts: [workout({ id: 'w3', date: '2026-10-29' })] }));
    await act(async () => {
      jest.advanceTimersByTime(CALENDAR_DEBOUNCE_MS);
    });
    expect(mockSyncCalendar).toHaveBeenCalledTimes(1);
  });

  test('nothing runs while not ready or without workouts', async () => {
    await renderHook(() => usePlanMirrors(false, snapshot()));
    await renderHook(() => usePlanMirrors(true, snapshot({ workouts: undefined })));
    await act(async () => {
      jest.advanceTimersByTime(CALENDAR_DEBOUNCE_MS * 2);
    });
    expect(mockSyncCalendar).not.toHaveBeenCalled();
    expect(mockSyncWidgets).not.toHaveBeenCalled();
  });
});
