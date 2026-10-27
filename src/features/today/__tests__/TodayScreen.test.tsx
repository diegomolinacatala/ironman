import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import TodayScreen from '@/app/(tabs)/today';
import type { JointSession, NutritionLog, Workout } from '@/domain/types';
import { ME, makeSession, makeWorkout } from '@/features/workouts/__tests__/fixtures';

import type { TodayData } from '../useTodayData';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockActions = {
  moveTo: jest.fn(async (_w: Workout, _date: string) => true),
  moveToTomorrow: jest.fn(async (_w: Workout) => true),
  duplicate: jest.fn(async (_w: Workout) => null),
  remove: jest.fn(async (_w: Workout) => true),
  skip: jest.fn(async (_w: Workout) => true),
  reset: jest.fn(async (_w: Workout) => true),
  invite: jest.fn((_w: Workout) => undefined),
  busy: false,
};
let mockData: TodayData;
let mockCalendarEnabled = false;

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
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../useTodayData', () => ({ useTodayData: () => mockData }));
jest.mock('@/features/workouts/useWorkoutActions', () => ({ useWorkoutActions: () => mockActions }));
jest.mock('@/features/briefing/BriefingCard', () => ({ BriefingCard: () => null }));
jest.mock('@/integrations/calendar/trainingCalendar', () => ({
  useTrainingCalendar: () => ({ enabled: mockCalendarEnabled, syncedWorkoutIds: ['h'] }),
}));
jest.mock('@/integrations/camera/mealPhoto', () => ({ mealPhotoUri: () => null }));
jest.mock('@/data/queries', () => ({ useCompleteWorkout: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }) }));

function meal(overrides: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'n1',
    userId: ME,
    date: '2026-10-25',
    meal: 'lunch',
    description: 'Pasta con atún',
    kcal: 640,
    carbsG: 90,
    proteinG: 32,
    fatG: 14,
    createdAt: '2026-10-25T13:00:00.000Z',
    ...overrides,
  };
}

function data(overrides: Partial<TodayData> = {}): TodayData {
  return {
    today: '2026-10-25',
    tomorrow: '2026-10-26',
    myId: ME,
    displayName: 'Diego Molina',
    todayWorkouts: [],
    tomorrowWorkouts: [],
    jointSessions: [],
    invites: [],
    proposals: [],
    race: null,
    racesReady: true,
    phase: null,
    meals: [],
    unread: 0,
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
  mockCalendarEnabled = false;
});

describe('Hoy', () => {
  test('greets by first name and shows the date line', async () => {
    mockData = data();
    await render(<TodayScreen />);
    expect(screen.getByText(/^(Buenos días|Buenas tardes|Buenas noches), Diego$/)).toBeTruthy();
    expect(screen.getByText('Domingo 25 de octubre · Semana 43')).toBeTruthy();
  });

  test("today's session with structure, calendar badge and actions", async () => {
    mockCalendarEnabled = true;
    const hero: Workout = makeWorkout({
      id: 'h',
      title: 'Rodaje Z2',
      startTime: '18:30',
      jointSessionId: 's1',
      steps: [{ kind: 'warmup', durationMin: 10 }],
    });
    const session: JointSession = makeSession({ status: 'confirmed' });
    mockData = data({ todayWorkouts: [hero], jointSessions: [session], unread: 3 });
    await render(<TodayScreen />);
    expect(screen.getByText('Rodaje Z2')).toBeTruthy();
    expect(screen.getByText("10' Calentamiento")).toBeTruthy();
    expect(screen.getByLabelText('Está en tu calendario')).toBeTruthy();
    expect(screen.getByLabelText('Quedada con Álex')).toBeTruthy();
    expect(screen.getByLabelText('Avisos, 3 sin leer')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Tu entreno de hoy/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/workout/h');
    expect(screen.queryByRole('button', { name: 'Ha surgido algo' })).toBeNull();
  });

  test('rest day message', async () => {
    mockData = data();
    await render(<TodayScreen />);
    expect(screen.getByText('Hoy toca descanso')).toBeTruthy();
  });

  test('meals: tiles, totals and the + Foto shortcut', async () => {
    mockData = data({ meals: [meal({ id: 'a', meal: 'breakfast', kcal: 1200 }), meal({ id: 'b' })] });
    await render(<TodayScreen />);
    expect(screen.getByText('Hoy llevas 1.840 kcal · 180 g HC · 64 g proteína')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Desayuno: Pasta con atún/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/nutrition?date=2026-10-25');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir una comida con una foto' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/meal?source=camera');
  });

  test('pending invites and proposals become banners', async () => {
    mockData = data({
      invites: [makeSession()],
      proposals: [
        {
          id: 'p1',
          userId: ME,
          kind: 'replan',
          source: 'claude',
          weekStart: '2026-10-19',
          summary: 'Menos intensidad tras el pádel',
          changes: [],
          status: 'pending',
          model: null,
          createdAt: '2026-10-25T07:00:00.000Z',
        },
      ],
    });
    await render(<TodayScreen />);
    await fireEvent.press(screen.getByText('Tirada larga'));
    expect(mockRouter.push).toHaveBeenCalledWith('/joint/s1');
    await fireEvent.press(screen.getByText('Menos intensidad tras el pádel'));
    expect(mockRouter.push).toHaveBeenCalledWith('/proposal/p1');
  });

  test('shows an error with retry', async () => {
    const refresh = jest.fn(async () => undefined);
    mockData = data({ error: new Error('Sin conexión'), refresh });
    await render(<TodayScreen />);
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    await fireEvent.press(screen.getByText('Reintentar'));
    expect(refresh).toHaveBeenCalled();
  });
});
