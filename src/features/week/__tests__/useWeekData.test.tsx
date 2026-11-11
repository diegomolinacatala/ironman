import { describe, expect, jest, test } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { addDays, startOfWeek, todayISO, weekRange } from '@/domain/dates';
import type { DateRange, WeekPlan } from '@/domain/types';
import { makeProfile, makeRace } from '@/features/workouts/__tests__/fixtures';

import { useWeekData } from '../useWeekData';
import { weekPhaseOf } from '../weekModel';

const monday = startOfWeek(todayISO());
const mockRaces = [makeRace({ date: addDays(monday, 7 * 20 + 6) })];
const mockProfile = makeProfile();
const mockPlans: WeekPlan[] = [
  { weekStart: monday, kind: 'push', targetMinutes: null, note: 'Puente', source: 'manual', updatedAt: '2026-11-09T08:00:00Z' },
];
const mockWeekPlans = jest.fn((_range: DateRange) => mockPlans);

jest.mock('@/data/context', () => ({ useAuth: () => ({ session: { userId: 'user-me' } }) }));
jest.mock('@/data/queries', () => {
  const ok = <T,>(data: T) => ({ data, isLoading: false, isRefetching: false, error: null, refetch: jest.fn(async () => undefined) });
  return {
    useWorkouts: () => ok([]),
    useLifeEvents: () => ok([]),
    useBusyBlocks: () => ok([]),
    useJointSessions: () => ok([]),
    useRaces: () => ok(mockRaces),
    useProfile: () => ok(mockProfile),
    useWeekPlans: (range: DateRange) => ok(mockWeekPlans(range)),
  };
});

describe('useWeekData', () => {
  test("loads the week's plan and exposes the adjusted phase and objective", async () => {
    const { result } = await renderHook(() => useWeekData(monday));
    expect(mockWeekPlans).toHaveBeenCalledWith(weekRange(monday));
    const expected = weekPhaseOf(monday, mockRaces, mockProfile, mockPlans);
    expect(result.current.weekPlan).toEqual(mockPlans[0]);
    expect(result.current.phase).toEqual(expected.phase);
    expect(result.current.phase?.focus).toContain('más volumen');
    expect(result.current.targetHours).toBe(expected.targetHours);
    expect(result.current.targetHours).toBeGreaterThan(weekPhaseOf(monday, mockRaces, mockProfile, []).targetHours ?? 0);
  });
});
