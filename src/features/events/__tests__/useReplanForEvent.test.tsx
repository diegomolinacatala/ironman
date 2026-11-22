import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { DateRange, PlanChange, ProposalDraft, WeekPlan } from '@/domain/types';
import { makeBusy, makeEvent, makeProfile, makeWorkout } from '@/domain/__tests__/fixtures';

import { replanWindowFor, useReplanForEvent } from '../useReplanForEvent';

const today = todayISO();
const tomorrow = addDays(today, 1);
const mockRanges: Record<string, DateRange[]> = {};
const mockLoading: Record<string, boolean> = {};
const mockData: Record<string, unknown> = {};
const mockCreate = jest.fn(async (draft: ProposalDraft) => ({ ...draft, id: 'p1' }));
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({ router: { replace: (href: string) => mockReplace(href) } }));
jest.mock('@/data/queries', () => {
  const q = (name: string) => (range?: DateRange) => {
    if (range) mockRanges[name] = [...(mockRanges[name] ?? []), range];
    return { data: mockLoading[name] ? undefined : mockData[name], isLoading: Boolean(mockLoading[name]), error: null };
  };
  return {
    useWorkouts: q('workouts'),
    useBusyBlocks: q('busy'),
    useLifeEvents: q('events'),
    useProfile: q('profile'),
    useJointSessions: q('joint'),
    useRaces: q('races'),
    useWeekPlans: q('weekPlans'),
    useCreateProposal: () => ({ mutateAsync: mockCreate, isPending: false }),
  };
});

beforeEach(() => {
  for (const k of Object.keys(mockRanges)) delete mockRanges[k];
  for (const k of Object.keys(mockLoading)) delete mockLoading[k];
  Object.assign(mockData, { workouts: [], busy: [], events: [], profile: makeProfile(), joint: [], races: [], weekPlans: [] });
  mockCreate.mockClear();
  mockReplace.mockClear();
});

describe('replanWindowFor', () => {
  test('loads the whole engine window (today..today+13) from the Monday of the week', () => {
    const w = replanWindowFor({ startDate: '2026-10-29' }, '2026-10-27');
    expect(w.replanToday).toBe('2026-10-27');
    expect(w.weekStart).toBe('2026-10-26');
    expect(w.range).toEqual({ from: '2026-10-26', to: '2026-11-09' });
  });

  test('a future week starts its window on its Monday', () => {
    const w = replanWindowFor({ startDate: '2026-11-12' }, '2026-10-27');
    expect(w.replanToday).toBe('2026-11-09');
    expect(w.range).toEqual({ from: '2026-11-09', to: '2026-11-22' });
  });
});

describe('useReplanForEvent', () => {
  const event = makeEvent({ id: 'ev', kind: 'social', severity: 1, title: 'Cena', startDate: tomorrow, startTime: '18:30', durationMin: 180 });

  test.each(['busy', 'events', 'joint', 'races', 'weekPlans', 'workouts', 'profile'])('not ready while %s is loading', async (name) => {
    mockLoading[name] = true;
    const { result } = await renderHook(() => useReplanForEvent(event));
    expect(result.current.ready).toBe(false);
  });

  test('queries cover the engine window (replanToday..+13) and busy blocks reach the engine', async () => {
    const bike = makeWorkout({ id: 'bike', date: tomorrow, sport: 'bike', durationMin: 90, title: 'Bici Z2' });
    mockData.workouts = [bike];
    mockData.busy = [makeBusy(`${tomorrow}T07:00:00`, `${tomorrow}T18:00:00`)];
    const { result } = await renderHook(() => useReplanForEvent(event));
    expect(result.current.ready).toBe(true);
    const { range: expected, replanToday } = replanWindowFor(event, today);
    expect(expected.to).toBe(addDays(replanToday, 13));
    expect(mockRanges.workouts?.[0]).toEqual(expected);
    expect(mockRanges.busy?.[0]).toEqual(expected);
    expect(mockRanges.joint?.[0]).toEqual(expected);
    await act(async () => {
      await result.current.run();
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const changes = (mockCreate.mock.calls[0]?.[0] as ProposalDraft).changes as PlanChange[];
    expect(changes.some((c) => c.op !== 'add' && c.workoutId === 'bike')).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/proposal/p1');
  });

  test("passes the week's plan (Plan → General)", async () => {
    const run = makeWorkout({ id: 'run', date: tomorrow, sport: 'run', durationMin: 60, title: 'Rodaje suave' });
    const plan: WeekPlan = { weekStart: startOfWeek(tomorrow), kind: 'rest', targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-11-01T08:00:00Z' };
    mockData.workouts = [run];
    mockData.busy = [makeBusy(`${tomorrow}T07:00:00`, `${tomorrow}T18:00:00`)];
    mockData.weekPlans = [plan];
    const { result } = await renderHook(() => useReplanForEvent({ ...event, durationMin: 240, startTime: '18:00' }));
    await act(async () => {
      await result.current.run();
    });
    const draft = mockCreate.mock.calls[0]?.[0] as ProposalDraft | undefined;
    // The engine's week is tomorrow's week (today, or next Monday on Sundays).
    expect(draft?.changes.find((c) => c.op !== 'add' && c.workoutId === 'run')?.op).toBe('delete');
  });
});
