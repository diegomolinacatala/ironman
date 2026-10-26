import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AvailabilitySettingsScreen from '@/app/settings/availability';
import CalendarFeedScreen from '@/app/settings/calendar-feed';
import ConnectClaudeScreen from '@/app/settings/claude';
import IntegrationsScreen from '@/app/settings/integrations';
import NotificationSettingsScreen from '@/app/settings/notifications';
import ProfileSettingsScreen from '@/app/settings/profile';
import type { CreatedToken, PersonalToken, Profile } from '@/domain/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: { mode: 'demo' | 'supabase'; tokens: PersonalToken[] } = { mode: 'supabase', tokens: [] };
/** EXPO_PUBLIC_AI_COACH: off by default, as in the app. */
const mockEnvFlags = { aiCoachEnabled: false };

const mockProfile: Profile = {
  id: 'u1',
  username: 'diego',
  displayName: 'Diego',
  avatarUrl: null,
  sports: ['swim', 'bike', 'run'],
  level: 'intermediate',
  thresholds: { ftpW: 240, restingHr: 48 },
  availability: { weeklyHoursTarget: 9, restDay: 0, longSessionDays: [5, 6], windows: [], poolDays: [] },
  visibility: 'full',
  notificationPrefs: {
    workoutReminders: true,
    reminderMinutesBefore: 30,
    morningSummary: true,
    morningTime: '07:30',
    eveningCheckin: true,
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

function createdToken(scope: 'mcp' | 'ics'): CreatedToken {
  const secret = 'rb_0123456789abcdef';
  const url =
    scope === 'mcp' ? `https://x.supabase.co/functions/v1/mcp/u/${secret}` : `https://x.supabase.co/functions/v1/ics/${secret}.ics`;
  return {
    secret,
    url,
    token: { id: 't1', scope, label: 'x', prefix: 'rb_0123456', createdAt: '2026-10-25T10:00:00Z', lastUsedAt: null, revokedAt: null },
  };
}

const mockCreateToken = jest.fn(async ({ scope }: { scope: 'mcp' | 'ics'; label: string }) => createdToken(scope));
const mockRevokeToken = jest.fn(async (_id: string) => undefined);
const mockConnectGarmin = jest.fn(async (_vars: { apiKey: string; expiresAt: string | null }) => undefined);
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => ({ ...mockProfile, ...patch }));
const mockReschedule = jest.fn(async (_input: unknown) => 3);
const mockSetString = jest.fn(async (_text: string) => true);

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetString(text) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  // A lazy getter (not a spread, which would read it at import time) so each test can flip the flag.
  return Object.defineProperty({ ...actual }, 'env', {
    enumerable: true,
    get: () => ({ ...actual.env, aiCoachEnabled: mockEnvFlags.aiCoachEnabled }),
  });
});

jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'u1', email: null }, isLoading: false, auth: {}, mode: mockState.mode }),
}));

jest.mock('@/data/queries', () => {
  const mutation = <T,>(fn: T) => ({ mutateAsync: fn, isPending: false, variables: undefined });
  return {
    useProfile: () => ({ data: mockProfile, isLoading: false, isError: false, refetch: jest.fn() }),
    useUpdateProfile: () => mutation(mockUpdateProfile),
    useUsernameAvailable: () => ({ data: true, isFetching: false, isError: false }),
    useWorkouts: () => ({ data: [], isLoading: false, isError: false }),
    useTokens: () => ({ data: mockState.tokens, isLoading: false, isError: false, refetch: jest.fn() }),
    useCreateToken: () => mutation(mockCreateToken),
    useRevokeToken: () => mutation(mockRevokeToken),
    useIntegrations: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
    useConnectGarmin: () => mutation(mockConnectGarmin),
    useSyncGarmin: () => mutation(jest.fn()),
    useDisconnectGarmin: () => mutation(jest.fn()),
  };
});

jest.mock('@/integrations/hooks', () => ({
  useNotificationPermission: () => ({ status: 'granted', request: async () => true }),
  useCalendarIntegration: () => ({
    permission: 'granted',
    calendars: [{ id: 'c1', title: 'Clases', color: '#ff0000', source: 'iCloud' }],
    selectedIds: ['c1'],
    lastSync: null,
    busy: false,
    request: async () => undefined,
    setSelected: async () => undefined,
    syncNow: async () => undefined,
  }),
  useHealthIntegration: () => ({
    available: true,
    enabled: false,
    lastSync: null,
    busy: false,
    connect: async () => undefined,
    syncNow: async () => undefined,
    disable: async () => undefined,
  }),
}));

jest.mock('@/integrations/notifications', () => ({
  rescheduleLocalNotifications: (input: unknown) => mockReschedule(input),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mode = 'supabase';
  mockState.tokens = [];
  mockEnvFlags.aiCoachEnabled = false;
});

describe('Conecta tu Claude', () => {
  test('generates the MCP URL once and copies it', async () => {
    await render(<ConnectClaudeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Generar mi URL' }));
    await waitFor(() => expect(mockCreateToken).toHaveBeenCalledWith({ scope: 'mcp', label: 'Claude' }));
    expect(await screen.findByText('https://x.supabase.co/functions/v1/mcp/u/rb_0123456789abcdef')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('https://x.supabase.co/functions/v1/mcp/u/rb_0123456789abcdef'));
  });

  test('lists active tokens and shows the demo explanation', async () => {
    mockState.mode = 'demo';
    mockState.tokens = [createdToken('mcp').token, { ...createdToken('ics').token, id: 't2' }];
    await render(<ConnectClaudeScreen />);
    expect(screen.getByText(/Conectar tu Claude necesita el servidor/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Revocar' })).toHaveLength(1);
  });

  test('with the AI coach off there is no comparison with it and no Anthropic consent link', async () => {
    await render(<ConnectClaudeScreen />);
    expect(screen.getByText(/ponle de nombre Road to Ironman/)).toBeTruthy();
    expect(screen.queryByText('¿Y el Coach IA de la app?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir el Coach IA' })).toBeNull();
    expect(screen.queryByText(/Coach IA/)).toBeNull();
    expect(screen.queryByText(/Anthropic/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /Privacidad/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/privacy');
  });

  test('with the AI coach on it still explains the difference', async () => {
    mockEnvFlags.aiCoachEnabled = true;
    await render(<ConnectClaudeScreen />);
    expect(screen.getByText('¿Y el Coach IA de la app?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Privacidad y Coach IA/ })).toBeTruthy();
  });
});

describe('Calendario en tu iPhone', () => {
  test('shows the webcal URL and opens Calendar', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<CalendarFeedScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Generar enlace de calendario' }));
    const webcal = 'webcal://x.supabase.co/functions/v1/ics/rb_0123456789abcdef.ics';
    expect(await screen.findByText(webcal)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir a Calendario' }));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(webcal));
  });
});

describe('Conexiones', () => {
  test('connects Garmin with the pasted key and chosen expiry', async () => {
    await render(<IntegrationsScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Pega aquí tu clave'), '  abcdefghijklmnopqrstuvwxyz  ');
    await fireEvent.press(screen.getByRole('button', { name: '30 días' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Conectar' }));
    await waitFor(() => expect(mockConnectGarmin).toHaveBeenCalledTimes(1));
    const vars = mockConnectGarmin.mock.calls[0]?.[0];
    expect(vars?.apiKey).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(vars?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText('Clases')).toBeTruthy();
  });

  test('calendar copy is accurate and the privacy summary is one tap away', async () => {
    await render(<IntegrationsScreen />);
    expect(screen.getByText(/tu plan solo usa las horas ocupadas, nunca los títulos/)).toBeTruthy();
    expect(screen.queryByText(/nunca salen de tu cuenta/)).toBeNull();
    expect(screen.queryByText(/Coach IA|Anthropic/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /Cómo usamos estos datos/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/privacy');
  });

  test('with the AI coach on, the calendar and Salud copy say what the Coach IA receives', async () => {
    mockEnvFlags.aiCoachEnabled = true;
    await render(<IntegrationsScreen />);
    expect(screen.getByText(/el Coach IA solo recibe las horas ocupadas, nunca los títulos/)).toBeTruthy();
    expect(screen.getByText(/se envía a Anthropic para planificar/)).toBeTruthy();
  });

  test('Garmin is disabled in demo mode', async () => {
    mockState.mode = 'demo';
    await render(<IntegrationsScreen />);
    expect(screen.getByText(/En modo demo no hay servidor/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Pega aquí tu clave')).toBeNull();
  });
});

describe('Notificaciones', () => {
  test('saves prefs and reschedules local notifications', async () => {
    await render(<NotificationSettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '1 h' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile.mock.calls[0]?.[0]).toMatchObject({ notificationPrefs: { reminderMinutesBefore: 60 } });
    await waitFor(() => expect(mockReschedule).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });
});

describe('Disponibilidad', () => {
  test('a save error is shown next to the pinned button', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('Sin conexión'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<AvailabilitySettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar disponibilidad' }));
    await waitFor(() => expect(within(screen.getByTestId('availability-footer')).getByText('Sin conexión')).toBeTruthy());
    warn.mockRestore();
  });
});

describe('Perfil', () => {
  test('saves thresholds and coach notes, keeping unmanaged threshold fields', async () => {
    await render(<ProfileSettingsScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('4:30'), '4:20');
    await fireEvent.changeText(screen.getByPlaceholderText(/Lo que tu coach debe saber/), ' Vegetariano ');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile.mock.calls[0]?.[0]).toMatchObject({
      thresholds: { ftpW: 240, restingHr: 48, runThresholdPaceSecPerKm: 260 },
      coachNotes: 'Vegetariano',
    });
  });
});
