import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import WorkoutDetailScreen from '@/app/workout/[id]';
import type { Workout } from '@/domain/types';

import { ME, makeWorkout } from './fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockRedirect = jest.fn((_href: string) => null);
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
let mockAuth = { session: { userId: ME, email: null } as { userId: string; email: string | null } | null, isLoading: false };
let mockWorkout: { data: Workout | null | undefined; isLoading: boolean } = { data: undefined, isLoading: false };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Redirect: ({ href }: { href: string }) => mockRedirect(href),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'w1' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));
jest.mock('@/data/context', () => ({ useAuth: () => mockAuth }));
jest.mock('@/data/queries', () => ({
  useWorkout: () => ({ ...mockWorkout, error: null, refetch: jest.fn(), isRefetching: false }),
  useJointSession: () => ({ data: null, isLoading: false, error: null }),
}));
jest.mock('@/features/workouts/useWorkoutActions', () => ({ useWorkoutActions: () => mockActions }));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  mockAuth = { session: { userId: ME, email: null }, isLoading: false };
  mockWorkout = { data: undefined, isLoading: false };
});

describe('workout detail', () => {
  test('waits for the session instead of flashing "no encontrado" (cold-start widget link)', async () => {
    mockAuth = { session: null, isLoading: true };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText('Entreno no encontrado')).toBeNull();
    expect(screen.getByLabelText('Cargando entreno')).toBeTruthy();
  });

  test('signed out sends the user through the entry gate', async () => {
    mockAuth = { session: null, isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  test('not found with no back stack offers a way to Hoy', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    mockWorkout = { data: null, isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText('Entreno no encontrado')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('deleting with no back stack lands on Hoy', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    mockWorkout = { data: makeWorkout({ id: 'w1' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(mockActions.remove).toHaveBeenCalledTimes(1);
  });

  test('deleting goes back when there is a previous screen', async () => {
    mockWorkout = { data: makeWorkout({ id: 'w1' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
