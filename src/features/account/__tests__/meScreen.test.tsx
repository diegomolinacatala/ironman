import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import MeScreen from '@/app/(tabs)/me';
import type { Profile } from '@/domain/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockUpdateProfile = jest.fn(async (patch: Record<string, unknown>) => patch);
const mockAuth = { signOut: jest.fn(async () => undefined), deleteAccount: jest.fn(async () => undefined) };

const mockProfile: Profile = {
  id: 'u1',
  username: 'diego',
  displayName: 'Diego',
  avatarUrl: null,
  sports: ['swim', 'bike', 'run'],
  level: 'intermediate',
  thresholds: { ftpW: 240 },
  availability: { weeklyHoursTarget: 9, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] },
  visibility: 'full',
  notificationPrefs: {
    workoutReminders: true,
    reminderMinutesBefore: 30,
    morningSummary: true,
    morningTime: '07:30',
    eveningCheckin: false,
    eveningTime: '21:30',
    weeklyPlanReminder: true,
    social: true,
  },
  timezone: 'Europe/Madrid',
  coachNotes: null,
  onboardedAt: '2026-10-01T10:00:00.000Z',
  aiConsentAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
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

jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'u1', email: 'd@x.es' }, isLoading: false, auth: mockAuth, mode: 'demo' }),
}));

jest.mock('@/data/queries', () => ({
  useProfile: () => ({ data: mockProfile, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() }),
  useWorkouts: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  useIntegrations: () => ({ data: [] }),
  useRaces: () => ({ data: [] }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
}));

function confirmEverything(): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.[1]?.onPress?.();
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('Yo', () => {
  test('shows identity, demo badge and navigates to settings', async () => {
    await render(<MeScreen />);
    expect(screen.getByText('Diego')).toBeTruthy();
    expect(screen.getByText('@diego')).toBeTruthy();
    expect(screen.getByText('Modo demo')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Perfil y umbrales/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
    await fireEvent.press(screen.getByRole('button', { name: /Conecta tu Claude/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/claude');
  });

  test('changing visibility saves immediately', async () => {
    await render(<MeScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Solo ocupado' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ visibility: 'busy' }));
  });

  test('sign out asks for confirmation and goes to sign-in', async () => {
    confirmEverything();
    await render(<MeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(mockAuth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
  });

  test('delete account needs two confirmations', async () => {
    confirmEverything();
    await render(<MeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Borrar cuenta/ }));
    await waitFor(() => expect(mockAuth.deleteAccount).toHaveBeenCalled());
    expect(Alert.alert).toHaveBeenCalledTimes(2);
  });
});
