import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import RaceEditScreen from '@/app/races/edit';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockCreate = jest.fn(async () => ({ id: 'r1' }));
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
  // Render the header-left control so the test can find and press it.
  Stack: { Screen: ({ options }: { options?: { headerLeft?: () => unknown } }) => options?.headerLeft?.() ?? null },
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
  useRaces: () => ({ data: [], isLoading: false, error: null, refetch: jest.fn() }),
  useCreateRace: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateRace: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteRace: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  mockParams = {};
});

describe('races/edit', () => {
  test('has a Cancelar header control that falls back to Carreras without a back stack', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await render(<RaceEditScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/races');
  });

  test('an unknown race can be closed from the header', async () => {
    mockParams = { id: 'missing' };
    await render(<RaceEditScreen />);
    expect(screen.getByText('Carrera no encontrada')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cerrar' })[0]!);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('validation errors sit in the footer, above the button', async () => {
    await render(<RaceEditScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir carrera' }));
    expect(within(screen.getByTestId('form-footer')).getByText(/nombre/)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
