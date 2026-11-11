import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import PlanScreen from '@/app/(tabs)/week';
import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { Race, WeekPlan, WeekPlanDraft, Workout } from '@/domain/types';
import { makeProfile, makeRace, makeWorkout } from '@/features/workouts/__tests__/fixtures';

const mockRouter = { push: jest.fn(), setParams: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockSave = jest.fn(async (_drafts: WeekPlanDraft[]) => [] as WeekPlan[]);
const mockDelete = jest.fn(async (_weekStart: string) => undefined);
const mockRefetch = jest.fn(async () => undefined);
const mockProfile = makeProfile();
let mockRaces: Race[] = [];
let mockPlans: WeekPlan[] = [];
let mockWorkouts: Workout[] = [];
let mockRaceError: Error | null = null;

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ view: 'general' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => {
  const ok = <T,>(data: T) => ({ data, isLoading: false, isRefetching: false, error: null, refetch: mockRefetch });
  return {
    useRaces: () => (mockRaceError ? { ...ok(undefined), error: mockRaceError } : ok(mockRaces)),
    useProfile: () => ok(mockProfile),
    useWeekPlans: () => ok(mockPlans),
    useWorkouts: () => ok(mockWorkouts),
    useSaveWeekPlans: () => ({ mutateAsync: mockSave, isPending: false }),
    useDeleteWeekPlan: () => ({ mutateAsync: mockDelete, isPending: false }),
  };
});

// First render pulls in the whole screen tree (cold transform on CI/Windows).
jest.setTimeout(30000);

const monday = startOfWeek(todayISO());

beforeEach(() => {
  jest.clearAllMocks();
  mockRaces = [];
  mockPlans = [];
  mockWorkouts = [];
  mockRaceError = null;
});

describe('Plan → General', () => {
  test('shows the road to the race with this week highlighted', async () => {
    mockRaces = [makeRace({ id: 'r1', name: 'Valencia', date: addDays(monday, 7 * 12 + 6) })];
    mockWorkouts = [makeWorkout({ id: 'w1', date: monday }), makeWorkout({ id: 'w2', date: addDays(monday, 2) })];
    await render(<PlanScreen />);
    expect(screen.getByText('Hacia tu carrera')).toBeTruthy();
    expect(screen.getByText('Valencia')).toBeTruthy();
    expect(screen.getByRole('image', { name: /^Horas por semana durante 13 semanas/ })).toBeTruthy();
    expect(screen.getByTestId('volume-current')).toBeTruthy();
    expect(screen.getByTestId('season-week-current')).toBeTruthy();
    expect(screen.getByText('Afinamiento y carrera')).toBeTruthy();
    expect(screen.getByText('Detallada · 2 sesiones', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByText(/lo marca la carrera|la organiza la carrera/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Hablar del plan con tu coach' }));
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/coach?mode=chat&message=${encodeURIComponent('Explícame cómo organizamos las próximas semanas hasta la carrera')}`,
    );
  });

  test('a week row opens that week and the switch goes back to Semana', async () => {
    await render(<PlanScreen />);
    await fireEvent.press(screen.getByTestId('season-week-current'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ view: 'week', week: monday });
    await fireEvent.press(screen.getByRole('tab', { name: 'Semana' }));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ view: 'week' });
  });

  test('without a race: one way to add it and 8 maintenance weeks', async () => {
    await render(<PlanScreen />);
    expect(screen.getByText('Sin carrera a la vista')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Ajustar semana' })).toHaveLength(8);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir carrera' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/races/edit?from=plan');
  });

  test('Ajustar semana saves a descarga for that week', async () => {
    await render(<PlanScreen />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Ajustar semana' })[0]!);
    await fireEvent.press(screen.getByRole('radio', { name: /^Descarga/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    expect(mockSave).toHaveBeenCalledWith([{ weekStart: monday, kind: 'recovery', targetMinutes: null, note: null, source: 'manual' }]);
  });

  test('an adjusted week says so and the override can be removed', async () => {
    mockPlans = [{ weekStart: monday, kind: 'push', targetMinutes: null, note: 'Puente: más horas', source: 'manual', updatedAt: '2026-11-09T08:00:00Z' }];
    await render(<PlanScreen />);
    expect(screen.getByText('Puente: más horas')).toBeTruthy();
    expect(screen.getAllByText('Ajustada', { includeHiddenElements: true })).toHaveLength(1);
    await fireEvent(screen.getByTestId('season-week-current'), 'longPress');
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar ajuste' }));
    expect(mockDelete).toHaveBeenCalledWith(monday);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('a loading error can be retried', async () => {
    mockRaceError = new Error('Sin conexión');
    await render(<PlanScreen />);
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
