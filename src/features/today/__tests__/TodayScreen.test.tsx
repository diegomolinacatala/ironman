import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import TodayScreen from '@/app/(tabs)/today';
import type { Readiness } from '@/domain/readiness';
import type { JointSession, Workout } from '@/domain/types';
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
jest.mock('../useTodayData', () => ({ useTodayData: () => mockData }));
jest.mock('@/features/workouts/useWorkoutActions', () => ({ useWorkoutActions: () => mockActions }));
jest.mock('@/data/queries', () => ({ useCompleteWorkout: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }) }));

const readiness: Readiness = { score: 72, level: 'green', factors: ['VFC en tu media'], recommendation: 'Adelante con el plan.' };

function data(overrides: Partial<TodayData> = {}): TodayData {
  return {
    today: '2026-10-25',
    tomorrow: '2026-10-26',
    myId: ME,
    todayWorkouts: [],
    tomorrowWorkouts: [],
    jointSessions: [],
    invites: [],
    proposals: [],
    race: null,
    racesReady: true,
    phase: null,
    readiness,
    checkin: null,
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
});

describe('Hoy', () => {
  test('shows the next session as hero with quick actions', async () => {
    const hero: Workout = makeWorkout({ id: 'h', title: 'Rodaje Z2', startTime: '18:30', jointSessionId: 's1' });
    const session: JointSession = makeSession({ status: 'confirmed' });
    mockData = data({ todayWorkouts: [hero], jointSessions: [session], unread: 3 });
    await render(<TodayScreen />);
    expect(screen.getByText('Rodaje Z2')).toBeTruthy();
    expect(screen.getByLabelText('Quedada con Álex')).toBeTruthy();
    expect(screen.getByLabelText('Avisos, 3 sin leer')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Saltar' }));
    expect(mockActions.skip).toHaveBeenCalledWith(hero);
    await fireEvent.press(screen.getByRole('button', { name: 'Ha surgido algo' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/event/edit?date=2026-10-25');
  });

  test('rest day message and check-in CTA when nothing is planned', async () => {
    mockData = data();
    await render(<TodayScreen />);
    expect(screen.getByText('Hoy toca descanso')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hacer check-in (30 s)' })).toBeTruthy();
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
