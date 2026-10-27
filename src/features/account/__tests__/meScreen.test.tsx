import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import MeScreen from '@/app/(tabs)/me';
import { addDays, todayISO } from '@/domain/dates';
import type { IntegrationStatus, PersonalToken, Profile, Race } from '@/domain/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockUpdateProfile = jest.fn(async (patch: Record<string, unknown>) => patch);
const mockSync = jest.fn(async () => ({ metricsDays: 1, activitiesImported: 0, workoutsCompleted: 0, message: 'ok' }));
const mockAuth = { signOut: jest.fn(async () => undefined), deleteAccount: jest.fn(async () => undefined) };

const mockData: { profile: Profile; races: Race[]; integrations: IntegrationStatus[]; tokens: PersonalToken[]; calendarEnabled: boolean } = {
  profile: null as unknown as Profile,
  races: [],
  integrations: [],
  tokens: [],
  calendarEnabled: false,
};

function profile(patch: Partial<Profile> = {}): Profile {
  return {
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
      morningSummary: false,
      morningTime: '07:30',
      eveningCheckin: false,
      eveningTime: '21:30',
      weeklyPlanReminder: true,
      social: true,
    },
    timezone: 'Europe/Madrid',
    coachNotes: 'Vegetariano\n- No nado los lunes',
    onboardedAt: '2026-10-01T10:00:00.000Z',
    aiConsentAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...patch,
  };
}

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null, DateTimePickerAndroid: { open: jest.fn() } }));
// The iOS compact picker reports every wheel step: a text input lets the test do the same.
jest.mock('@/features/workouts/DateField', () => {
  const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    TimeField: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} />
    ),
  };
});
jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'u1', email: 'd@x.es' }, isLoading: false, auth: mockAuth, mode: 'demo' }),
}));
jest.mock('@/data/queries', () => {
  const query = <T,>(data: T) => ({ data, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(async () => undefined) });
  return {
    useProfile: () => query(mockData.profile),
    useRaces: () => query(mockData.races),
    useIntegrations: () => query(mockData.integrations),
    useTokens: () => query(mockData.tokens),
    useSyncGarmin: () => ({ mutateAsync: mockSync, isPending: false }),
    useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
  };
});
jest.mock('@/integrations/hooks', () => ({
  useNotificationPermission: () => ({ status: 'granted', request: async () => true }),
}));
jest.mock('@/integrations/calendar/trainingCalendar', () => ({
  useTrainingCalendar: () => ({
    available: true,
    permission: 'granted',
    enabled: mockData.calendarEnabled,
    calendarTitle: null,
    alarmMinutes: 30,
    lastSync: null,
    busy: false,
    error: null,
  }),
}));

function confirmEverything(): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.[1]?.onPress?.();
  });
}

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockData.profile = profile();
  mockData.races = [];
  mockData.integrations = [];
  mockData.tokens = [];
  mockData.calendarEnabled = false;
});

describe('Tú', () => {
  test('header: name, demo badge and the countdown to the next race', async () => {
    mockData.races = [
      { id: 'r1', userId: 'u1', name: 'Valencia', date: addDays(todayISO(), 128), distance: 'olympic', priority: 'A', location: null, goal: null, notes: null, createdAt: '' },
    ];
    await render(<MeScreen />);
    expect(screen.getByText('Diego')).toBeTruthy();
    expect(screen.getByText('Modo demo')).toBeTruthy();
    expect(screen.getByText('128 días')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Faltan 128 días para Valencia/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/races');
  });

  test('connections show live status and one-tap fixes', async () => {
    mockData.integrations = [
      { provider: 'garmin_personal', state: 'connected', expiresAt: addDays(todayISO(), 300), lastSyncAt: new Date().toISOString(), lastError: null },
    ];
    mockData.calendarEnabled = true;
    await render(<MeScreen />);
    expect(screen.getByLabelText(/Garmin: Conectado. Sincronizado hace un momento/)).toBeTruthy();
    expect(screen.getByLabelText(/Calendario: Activado. Tus entrenos en tu calendario · aviso 30 min antes/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Garmin sincronizado.')).toBeTruthy();
    // Claude is not connected: one tap to fix it.
    await fireEvent.press(screen.getByRole('button', { name: 'Conectar' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/claude');
  });

  test('an expired Garmin key asks to renew it', async () => {
    mockData.integrations = [{ provider: 'garmin_personal', state: 'expired', expiresAt: null, lastSyncAt: null, lastError: null }];
    mockData.tokens = [
      { id: 't', scope: 'mcp', label: 'Claude', prefix: 'rb', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-26T10:00:00Z', revokedAt: null },
    ];
    await render(<MeScreen />);
    expect(screen.getByLabelText(/Garmin: Clave caducada/)).toBeTruthy();
    expect(screen.getByLabelText(/Claude: Conectado/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Renovar' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/integrations');
  });

  test('the morning report toggle saves right away', async () => {
    await render(<MeScreen />);
    await fireEvent(screen.getByLabelText('Informe de cada mañana'), 'valueChange', true);
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        notificationPrefs: expect.objectContaining({ morningSummary: true, morningTime: '07:30', workoutReminders: true }),
      }),
    );
  });

  test('time changes are debounced and saves run one after another without reverting the toggle', async () => {
    jest.useFakeTimers();
    let release: () => void = () => undefined;
    mockUpdateProfile.mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          release = () => resolve(patch);
        }),
    );
    await render(<MeScreen />);
    await fireEvent(screen.getByLabelText('Informe de cada mañana'), 'valueChange', true);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    for (const time of ['07:35', '07:40', '07:45']) await fireEvent.changeText(screen.getByLabelText('Hora del informe'), time);
    await act(async () => {
      jest.advanceTimersByTime(599);
    });
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    // Still one: the time save waits for the toggle save to finish.
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(2));
    expect(mockUpdateProfile.mock.calls[1]?.[0]).toEqual({
      notificationPrefs: expect.objectContaining({ morningSummary: true, morningTime: '07:45', workoutReminders: true }),
    });
  });

  test('what the coach knows: one line per fact, add / edit / delete', async () => {
    confirmEverything();
    await render(<MeScreen />);
    expect(screen.getByText('Vegetariano')).toBeTruthy();
    expect(screen.getByText('No nado los lunes')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Algo que tu coach deba saber'), 'Me duele la rodilla izquierda');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir' }));
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenLastCalledWith({ coachNotes: 'Vegetariano\nNo nado los lunes\nMe duele la rodilla izquierda' }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Borrar: Vegetariano' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenLastCalledWith({ coachNotes: 'No nado los lunes' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Editar: No nado los lunes' }));
    await fireEvent.changeText(screen.getByLabelText('Editar nota'), 'No nado lunes ni miércoles');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenLastCalledWith({ coachNotes: 'Vegetariano\nNo nado lunes ni miércoles' }));
  });

  test('a duplicate fact is not added twice', async () => {
    await render(<MeScreen />);
    await fireEvent.changeText(screen.getByLabelText('Algo que tu coach deba saber'), 'vegetariano');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir' }));
    expect(await screen.findByText('Tu coach ya lo sabe')).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('"Más" links to Juntos, Progreso and the settings', async () => {
    await render(<MeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^Juntos/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/together');
    await fireEvent.press(screen.getByRole('button', { name: /^Progreso/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/progress');
    await fireEvent.press(screen.getByRole('button', { name: /^Privacidad/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/privacy');
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
