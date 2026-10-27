import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import NutritionScreen from '@/app/nutrition';
import type { NutritionLog } from '@/domain/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
const mockDelete = jest.fn(async (_id: string) => undefined);
const mockDeletePhoto = jest.fn(async (_id: string) => undefined);
const mockConfirm = jest.fn(async () => true);
const mockLogs: NutritionLog[] = [
  {
    id: 'n1',
    userId: 'me',
    date: '2026-10-27',
    meal: 'lunch',
    description: 'Pasta con atún',
    kcal: 640,
    carbsG: null,
    proteinG: null,
    fatG: null,
    createdAt: '2026-10-27T12:00:00.000Z',
  },
];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ date: '2026-10-27' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => ({
  useNutrition: () => ({ data: mockLogs, isLoading: false, error: null, isRefetching: false, refetch: jest.fn() }),
  useWorkouts: () => ({ data: [], isLoading: false, error: null, refetch: jest.fn() }),
  useCreateNutrition: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteNutrition: () => ({ mutateAsync: mockDelete, isPending: false }),
}));
jest.mock('@/features/coach/confirm', () => ({ confirmAction: () => mockConfirm() }));
jest.mock('@/integrations/camera/mealPhoto', () => ({
  mealPhotoUri: () => null,
  deleteMealPhoto: (id: string) => mockDeletePhoto(id),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Nutrition', () => {
  test('deleting an entry also deletes its private photo', async () => {
    await render(<NutritionScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar «Pasta con atún»' }));
    await waitFor(() => expect(mockDeletePhoto).toHaveBeenCalledWith('n1'));
    expect(mockDelete).toHaveBeenCalledWith('n1');
  });

  test('a failed delete keeps the photo', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Sin conexión'));
    await render(<NutritionScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar «Pasta con atún»' }));
    expect(await screen.findByText('Sin conexión')).toBeTruthy();
    expect(mockDeletePhoto).not.toHaveBeenCalled();
  });

  test('"+ Foto" opens the meal camera for the shown day', async () => {
    await render(<NutritionScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '+ Foto' }));
    expect(mockRouter.push).toHaveBeenCalledWith(expect.stringMatching(/^\/meal\?source=camera/));
  });
});
