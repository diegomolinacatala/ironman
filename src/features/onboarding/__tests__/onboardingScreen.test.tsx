import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import OnboardingScreen from '@/app/onboarding';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  canDismiss: jest.fn(() => true),
  dismissAll: jest.fn(),
};
const mockUpdateProfile = jest.fn(async (patch: Record<string, unknown>) => ({ id: 'u1', ...patch }));
const mockCreateRace = jest.fn(async (draft: Record<string, unknown>) => ({ id: 'r1', ...draft }));
const mockRefetch = jest.fn(async () => undefined);
let mockProfile: { data: Record<string, unknown> | null | undefined; isLoading: boolean; error: Error | null } = {
  data: null,
  isLoading: false,
  error: null,
};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

jest.mock('@/data/queries', () => ({
  useProfile: () => ({ ...mockProfile, refetch: mockRefetch }),
  useUsernameAvailable: (username: string) => ({ data: username ? true : undefined, isFetching: false, isError: false }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
  useCreateRace: () => ({ mutateAsync: mockCreateRace, isPending: false }),
}));

jest.mock('@/integrations/hooks', () => ({
  useNotificationPermission: () => ({ status: 'undetermined', request: async () => true }),
  useCalendarIntegration: () => ({ permission: 'undetermined', request: async () => undefined }),
  useHealthIntegration: () => ({ available: false, enabled: false, connect: async () => undefined }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { data: null, isLoading: false, error: null };
});

async function pressNext(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
}

describe('onboarding', () => {
  test('walks through every step and saves the profile with onboardedAt', async () => {
    await render(<OnboardingScreen />);
    expect(screen.getByText('¿Cómo te llamamos?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Siguiente' }).props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(screen.getByPlaceholderText('Diego'), 'Diego Molina');
    await waitFor(() => expect(screen.getByText('@diego.molina está libre')).toBeTruthy());
    await pressNext();

    expect(screen.getByText('¿Qué entrenas?')).toBeTruthy();
    await pressNext();
    expect(screen.getByText('¿Cuándo puedes entrenar?')).toBeTruthy();
    await pressNext();
    expect(screen.getByText('Tus números')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Saltar' }));
    expect(screen.getByText('Tu próxima carrera')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Saltar' }));
    expect(screen.getByText('Que Rebufo trabaje por ti')).toBeTruthy();
    await pressNext();

    await fireEvent.press(screen.getByRole('button', { name: 'Empezar a entrenar' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    const patch = mockUpdateProfile.mock.calls[0]?.[0] ?? {};
    expect(patch).toMatchObject({
      displayName: 'Diego Molina',
      username: 'diego.molina',
      sports: ['swim', 'bike', 'run'],
      level: 'intermediate',
    });
    expect(typeof patch.onboardedAt).toBe('string');
    expect(mockCreateRace).not.toHaveBeenCalled();
  });

  test('a failed save shows the error and stays on the last step', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('Ese usuario ya existe'));
    await render(<OnboardingScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Diego'), 'Ana');
    await waitFor(() => expect(screen.getByText('@ana está libre')).toBeTruthy());
    for (let i = 0; i < 6; i += 1) {
      const skip = screen.queryByRole('button', { name: 'Saltar' });
      if (skip && i >= 3) await fireEvent.press(skip);
      else await pressNext();
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar a entrenar' }));
    expect(await screen.findByText('Ese usuario ya existe')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('a failed profile load shows a retry instead of an empty wizard', async () => {
    mockProfile = { data: undefined, isLoading: false, error: new Error('Network request failed') };
    await render(<OnboardingScreen />);
    expect(screen.getByText('No hemos podido cargar tu perfil. Revisa tu conexión.')).toBeTruthy();
    expect(screen.queryByText('¿Cómo te llamamos?')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('an already onboarded profile goes straight to Hoy', async () => {
    mockProfile = { data: { id: 'u1', username: 'diego', displayName: 'Diego', onboardedAt: '2026-10-01T10:00:00Z' }, isLoading: false, error: null };
    await render(<OnboardingScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(screen.queryByText('¿Cómo te llamamos?')).toBeNull();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
});
