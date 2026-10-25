import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import WorkoutEditScreen from '@/app/workout/edit';
import type { Workout, WorkoutDraft, WorkoutPatch } from '@/domain/types';

import { makeWorkout } from './fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockCreate = jest.fn(async (draft: WorkoutDraft): Promise<Workout> => makeWorkout({ ...draft, id: 'created' } as Partial<Workout>));
const mockUpdate = jest.fn(async (vars: { id: string; patch: WorkoutPatch }): Promise<Workout> => makeWorkout({ id: vars.id }));
let mockParams: Record<string, string> = {};
let mockWorkout: Workout | null = null;

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
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
jest.mock('@/data/queries', () => ({
  useWorkout: () => ({ data: mockWorkout, isLoading: false, error: null, refetch: jest.fn() }),
  useCreateWorkout: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateWorkout: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { date: '2026-10-27', sport: 'run' };
  mockWorkout = null;
});

describe('workout editor', () => {
  test('a quick template fills the form and saves a valid draft', async () => {
    await render(<WorkoutEditScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Series 6×1000' }));
    expect(screen.getByDisplayValue('Series 6×1000')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir entreno' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({
      date: '2026-10-27',
      sport: 'run',
      title: 'Series 6×1000',
      durationMin: 60,
      intensity: 'threshold',
      isKey: true,
      source: 'manual',
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test('a failed save stays open and shows the error above the button', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Sin conexión'));
    await render(<WorkoutEditScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir entreno' }));
    expect(await within(screen.getByTestId('form-footer')).findByText('Sin conexión')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('an unknown id can be closed', async () => {
    mockParams = { id: 'missing' };
    await render(<WorkoutEditScreen />);
    expect(screen.getByText('No encontramos este entreno')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('empty title gets a sensible default', async () => {
    mockParams = { date: '2026-10-27', sport: 'swim' };
    await render(<WorkoutEditScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir entreno' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0].title).toMatch(/45'/);
  });

  test('editing resets the planned load when the duration changes', async () => {
    mockParams = { id: 'w1' };
    mockWorkout = makeWorkout({ id: 'w1', tss: 50, durationMin: 45 });
    await render(<WorkoutEditScreen />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Sumar' })[0]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0]?.[0]).toMatchObject({ id: 'w1', patch: { durationMin: 50, tss: null } });
  });
});
