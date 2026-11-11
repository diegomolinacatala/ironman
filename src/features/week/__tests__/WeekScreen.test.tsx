import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import WeekScreen from '@/app/(tabs)/week';
import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { WeekSummary } from '@/domain/load';
import type { WeekPlan } from '@/domain/types';
import { ME, makeEvent, makeProfile, makeRace, makeWorkout } from '@/features/workouts/__tests__/fixtures';

import type { WeekData } from '../useWeekData';
import { weekPhaseOf } from '../weekModel';

const mockRouter = { push: jest.fn(), setParams: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockPlan = jest.fn(async (_weekStart: string, _data: WeekData) => undefined);
let mockData: WeekData;

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({}),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('../useWeekData', () => ({ useWeekData: () => mockData }));
jest.mock('../usePlanWeek', () => ({ usePlanWeek: () => ({ plan: mockPlan, busy: false }) }));
jest.mock('@/features/workouts/useWorkoutActions', () => ({
  useWorkoutActions: () => ({ busy: false, moveToTomorrow: jest.fn(), duplicate: jest.fn(), remove: jest.fn(), invite: jest.fn() }),
}));

const emptySummary: WeekSummary = {
  plannedMin: 0,
  completedMin: 0,
  plannedTss: 0,
  completedTss: 0,
  sessions: 0,
  completedSessions: 0,
  compliancePct: null,
  bySport: {},
};

function data(overrides: Partial<WeekData> = {}): WeekData {
  return {
    today: todayISO(),
    myId: ME,
    workouts: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    races: [],
    profile: null,
    summary: emptySummary,
    phase: null,
    weekPlan: null,
    targetHours: null,
    recentMinutes: [],
    history: [],
    isLoading: false,
    error: null,
    isRefreshing: false,
    refresh: async () => undefined,
    ...overrides,
  };
}

// First render pulls in the whole screen tree (cold transform on CI/Windows).
jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Semana', () => {
  test('empty week offers both planning CTAs', async () => {
    mockData = data();
    await render(<WeekScreen />);
    expect(screen.getByText('Semana en blanco')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Planificar semana' }));
    expect(mockPlan).toHaveBeenCalledWith(startOfWeek(todayISO()), mockData);
    // AI coach off by default (EXPO_PUBLIC_AI_COACH): the button is the plain rules coach.
    await fireEvent.press(screen.getByRole('button', { name: 'Coach IA' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/coach?mode=plan_week&weekStart=${startOfWeek(todayISO())}`);
  });

  test('lists sessions and imprevistos per day with totals', async () => {
    const today = todayISO();
    const w = makeWorkout({ id: 'w-today', date: today, title: 'Bici Z2', sport: 'bike', durationMin: 90 });
    const e = makeEvent({ id: 'e-today', startDate: today, endDate: today, title: 'Pádel con el curro' });
    mockData = data({
      workouts: [w],
      lifeEvents: [e],
      summary: { ...emptySummary, plannedMin: 90, sessions: 1, bySport: { bike: { plannedMin: 90, completedMin: 0, count: 1 } } },
    });
    await render(<WeekScreen />);
    expect(screen.getByText('Bici Z2')).toBeTruthy();
    expect(screen.getByText('Horas hechas / plan')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pádel con el curro' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/event/edit?id=e-today&date=${today}`);
  });

  test('the toolbar adds a session or an imprevisto on today when it is in the week', async () => {
    const today = todayISO();
    mockData = data({ workouts: [makeWorkout({ id: 'w-1', date: today })], summary: { ...emptySummary, sessions: 1 } });
    await render(<WeekScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir imprevisto' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/event/edit?date=${today}`);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir entreno' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/workout/edit?date=${today}`);
  });

  test('empty week still offers adding an imprevisto', async () => {
    mockData = data();
    await render(<WeekScreen />);
    expect(screen.getByRole('button', { name: 'Añadir imprevisto' })).toBeTruthy();
  });

  test('today is highlighted and headed in sentence case', async () => {
    mockData = data();
    await render(<WeekScreen />);
    expect(screen.getByTestId('day-today')).toBeTruthy();
    expect(screen.getByText(/^Hoy · /)).toBeTruthy();
  });

  test('opens on the week view and switches to General through ?view', async () => {
    mockData = data();
    await render(<WeekScreen />);
    expect(screen.getByRole('tab', { name: 'Semana', selected: true })).toBeTruthy();
    expect(screen.getByText('Semana en blanco')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'General' }));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ view: 'general' });
  });

  test('an adjusted week shows it in the phase line, which opens General', async () => {
    const monday = startOfWeek(todayISO());
    const plan: WeekPlan = { weekStart: monday, kind: 'recovery', targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-11-09T08:00:00Z' };
    const week = weekPhaseOf(monday, [makeRace({ date: addDays(monday, 7 * 20) })], makeProfile(), [plan]);
    mockData = data({ phase: week.phase, weekPlan: week.plan, targetHours: week.targetHours });
    await render(<WeekScreen />);
    expect(screen.getByText('Descarga')).toBeTruthy();
    expect(screen.getByText('Ajustada')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Ajustada/ }));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ view: 'general' });
  });

  test('week switcher updates the ?week param', async () => {
    mockData = data();
    await render(<WeekScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(mockRouter.setParams).toHaveBeenCalledTimes(1);
  });
});
