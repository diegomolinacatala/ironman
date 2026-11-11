import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import RaceEditScreen from '@/app/races/edit';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true) };
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

  test('a race added from Plan → General goes straight back there', async () => {
    mockParams = { from: 'plan' };
    const alert = jest.spyOn(Alert, 'alert');
    await render(<RaceEditScreen />);
    await fireEvent.changeText(screen.getByLabelText('Nombre de la carrera'), 'Triatlón de Valencia');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir carrera' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/week?view=general');
    expect(alert).not.toHaveBeenCalled();
  });

  test('after adding a race it offers the general plan', async () => {
    const answer = (index: number) =>
      jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons?: AlertButton[]) => buttons?.[index]?.onPress?.());
    const alert = answer(1);
    await render(<RaceEditScreen />);
    await fireEvent.changeText(screen.getByLabelText('Nombre de la carrera'), 'Triatlón de Valencia');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir carrera' }));
    expect(alert.mock.calls[0]?.[0]).toBe('Carrera guardada');
    expect(alert.mock.calls[0]?.[2]?.map((b) => b.text)).toEqual(['Ahora no', 'Ver plan general']);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/week?view=general');

    answer(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir carrera' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
