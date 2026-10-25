/**
 * Wiring tests for the rules-engine flows (real domain planner/replanner,
 * mocked data hooks): Planificar semana, imprevisto → re-plan, Ajustar hoy.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { addDays, startOfWeek, todayISO, weekRange } from '@/domain/dates';
import type { LifeEvent, PlanProposal, ProposalDraft, Workout } from '@/domain/types';
import { useAdjustToday } from '@/features/checkin/useAdjustToday';
import { useReplanForEvent } from '@/features/events/useReplanForEvent';
import { makeEvent, makeProfile, makeRace, makeWorkout } from '@/features/workouts/__tests__/fixtures';

import { usePlanWeek } from '../usePlanWeek';
import type { WeekData } from '../useWeekData';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockCreateProposal = jest.fn(
  async (draft: ProposalDraft): Promise<PlanProposal> => ({
    ...draft,
    id: 'proposal-1',
    userId: 'user-me',
    status: 'pending',
    model: null,
    createdAt: '2026-10-25T08:00:00.000Z',
  }),
);
let mockWorkouts: Workout[] = [];
let mockEvents: LifeEvent[] = [];
const mockProfile = makeProfile();
const mockRaces = [makeRace()];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('@/data/queries', () => {
  const ok = <T,>(data: T) => ({ data, isLoading: false, error: null });
  return {
    useCreateProposal: () => ({ mutateAsync: mockCreateProposal, isPending: false }),
    useWorkouts: () => ok(mockWorkouts),
    useBusyBlocks: () => ok([]),
    useLifeEvents: () => ok(mockEvents),
    useJointSessions: () => ok([]),
    useRaces: () => ok(mockRaces),
    useProfile: () => ok(mockProfile),
  };
});

jest.setTimeout(30000);

const today = todayISO();
const nextWeek = startOfWeek(addDays(today, 7));

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkouts = [];
  mockEvents = [];
});

function weekData(overrides: Partial<WeekData> = {}): WeekData {
  return {
    today,
    myId: 'user-me',
    workouts: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    races: [makeRace()],
    profile: makeProfile(),
    summary: {
      plannedMin: 0,
      completedMin: 0,
      plannedTss: 0,
      completedTss: 0,
      sessions: 0,
      completedSessions: 0,
      compliancePct: null,
      bySport: {},
    },
    phase: null,
    targetHours: 10,
    recentMinutes: [480, 500, 520, 400],
    history: [],
    isLoading: false,
    error: null,
    isRefreshing: false,
    refresh: async () => undefined,
    ...overrides,
  };
}

describe('Planificar semana', () => {
  test('stores a generate_week proposal from the rules engine and opens it', async () => {
    const { result } = await renderHook(() => usePlanWeek());
    await act(async () => {
      await result.current.plan(nextWeek, weekData());
    });
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);
    const draft = mockCreateProposal.mock.calls[0]?.[0];
    expect(draft).toMatchObject({ kind: 'generate_week', source: 'rules', weekStart: nextWeek });
    expect(draft?.changes.length).toBeGreaterThan(0);
    expect(draft?.changes.every((c) => c.op === 'add')).toBe(true);
    const range = weekRange(nextWeek);
    for (const c of draft?.changes ?? []) {
      if (c.op === 'add') expect(c.workout.date >= range.from && c.workout.date <= range.to).toBe(true);
    }
    expect(mockRouter.push).toHaveBeenCalledWith('/proposal/proposal-1');
  });

  test('refuses past weeks without calling the engine', async () => {
    const { result } = await renderHook(() => usePlanWeek());
    await act(async () => {
      await result.current.plan(startOfWeek(addDays(today, -14)), weekData());
    });
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });
});

describe('Imprevisto → reorganizar', () => {
  test('a knee injury produces a replan proposal and replaces the modal with it', async () => {
    const monday = nextWeek;
    mockWorkouts = [
      makeWorkout({ id: 'run-q', date: addDays(monday, 1), title: 'Series 6×1000', intensity: 'threshold', durationMin: 60 }),
      makeWorkout({ id: 'run-l', date: addDays(monday, 5), title: 'Tirada larga', durationMin: 90 }),
      makeWorkout({ id: 'swim', date: addDays(monday, 2), sport: 'swim', title: 'Técnica', durationMin: 45 }),
    ];
    const injury = makeEvent({
      id: 'inj',
      kind: 'injury',
      title: 'Rodilla',
      startDate: monday,
      endDate: addDays(monday, 6),
      startTime: null,
      durationMin: null,
      severity: 2,
      bodyArea: 'knee',
    });
    const { result } = await renderHook(() => useReplanForEvent(injury));
    expect(result.current.ready).toBe(true);
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.message).toBeNull();
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);
    const draft = mockCreateProposal.mock.calls[0]?.[0];
    expect(draft).toMatchObject({ kind: 'replan', source: 'rules', weekStart: monday });
    expect(draft?.changes.length).toBeGreaterThan(0);
    expect(draft?.changes.every((c) => c.reason.length > 0)).toBe(true);
    expect(mockRouter.replace).toHaveBeenCalledWith('/proposal/proposal-1');
  });
});

describe('Ajustar hoy', () => {
  test('a red readiness proposes changes for today or explains why not', async () => {
    mockWorkouts = [makeWorkout({ id: 'hard', date: today, title: 'Series', intensity: 'vo2', durationMin: 60 })];
    const { result } = await renderHook(() => useAdjustToday(today));
    await act(async () => {
      await result.current.run({ score: 20, level: 'red', factors: ['Sueño muy corto'], recommendation: 'Descansa' });
    });
    if (mockCreateProposal.mock.calls.length > 0) {
      expect(mockCreateProposal.mock.calls[0]?.[0]).toMatchObject({ kind: 'replan', source: 'rules' });
      expect(mockRouter.replace).toHaveBeenCalledWith('/proposal/proposal-1');
    } else {
      expect(result.current.message).toBeTruthy();
    }
  });
});
