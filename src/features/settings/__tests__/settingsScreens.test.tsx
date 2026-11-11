import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AvailabilitySettingsScreen from '@/app/settings/availability';
import CalendarFeedScreen from '@/app/settings/calendar-feed';
import ConnectClaudeScreen from '@/app/settings/claude';
import CorosGuideScreen from '@/app/settings/coros';
import IntegrationsScreen from '@/app/settings/integrations';
import NotificationSettingsScreen from '@/app/settings/notifications';
import ProfileSettingsScreen from '@/app/settings/profile';
import { addDays, todayISO } from '@/domain/dates';
import type { CreatedToken, PersonalToken, Profile } from '@/domain/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: { mode: 'demo' | 'supabase'; tokens: PersonalToken[]; profile: Profile | null } = { mode: 'supabase', tokens: [], profile: null };
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
const mockOpenBrowser = jest.fn(async (_url: string, _opts?: unknown) => ({ type: 'dismiss' }));
const COROS_RESULT = { metricsDays: 26, sleepNights: 26, activitiesFound: 12, workoutsCompleted: 3, activitiesImported: 9, sources: ['COROS'] };
/** Apple Salud on this device (how a COROS watch reaches us). */
const mockHealth = {
  available: true,
  loaded: true,
  enabled: false,
  lastSync: null as string | null,
  sources: [] as string[],
  busy: false,
  connect: jest.fn(async (_opts?: { days?: number }) => COROS_RESULT),
  syncNow: jest.fn(async (_opts?: { days?: number }) => COROS_RESULT),
  disable: jest.fn(async () => undefined),
};
const mockTraining = {
  enabled: false,
  enable: jest.fn(async () => true),
  disable: jest.fn(async (_opts?: { removeEvents?: boolean }) => undefined),
  setAlarmMinutes: jest.fn(async (_minutes: number) => undefined),
  syncNow: jest.fn(async () => undefined),
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

jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetString(text), isPasteButtonAvailable: false }));
jest.mock('expo-web-browser', () => ({
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
  openBrowserAsync: (url: string, opts?: unknown) => mockOpenBrowser(url, opts),
}));
jest.mock('@/integrations/calendar/trainingCalendar', () => ({
  useTrainingCalendar: () => ({
    available: true,
    permission: 'granted',
    enabled: mockTraining.enabled,
    calendarTitle: null,
    alarmMinutes: 30,
    lastSync: null,
    busy: false,
    error: null,
    enable: mockTraining.enable,
    disable: mockTraining.disable,
    setAlarmMinutes: mockTraining.setAlarmMinutes,
    syncNow: mockTraining.syncNow,
  }),
}));
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
    useProfile: () => ({ data: mockState.profile, isLoading: false, isError: false, refetch: jest.fn() }),
    useUpdateProfile: () => mutation(mockUpdateProfile),
    useUsernameAvailable: () => ({ data: true, isFetching: false, isError: false }),
    useWorkouts: () => ({ data: [], isLoading: false, isError: false }),
    useTokens: () => ({ data: mockState.tokens, isLoading: false, isError: false, refetch: jest.fn() }),
    useCreateToken: () => mutation(mockCreateToken),
    useRevokeToken: () => mutation(mockRevokeToken),
    useIntegrations: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
    useMetrics: () => ({ data: [], isLoading: false, isError: false }),
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
  FIRST_HEALTH_IMPORT_DAYS: 28,
  useHealthIntegration: () => ({ ...mockHealth }),
}));

jest.mock('@/integrations/notifications', () => ({
  rescheduleLocalNotifications: (input: unknown) => mockReschedule(input),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mode = 'supabase';
  mockState.tokens = [];
  mockState.profile = mockProfile;
  mockHealth.available = true;
  mockHealth.enabled = false;
  mockHealth.lastSync = null;
  mockHealth.sources = [];
  mockEnvFlags.aiCoachEnabled = false;
  mockTraining.enabled = false;
});

describe('Conecta tu Claude', () => {
  test('never mints a link on its own: "Crear mi enlace" creates, copies and opens claude.ai', async () => {
    await render(<ConnectClaudeScreen />);
    expect(mockCreateToken).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear mi enlace' }));
    await waitFor(() => expect(mockCreateToken).toHaveBeenCalledWith({ scope: 'mcp', label: 'Claude' }));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('https://x.supabase.co/functions/v1/mcp/u/rb_0123456789abcdef'));
    expect(await screen.findByText('https://x.supabase.co/functions/v1/mcp/u/rb_0123456789abcdef')).toBeTruthy();
    expect(screen.getByText(/Esperando a que Claude se conecte/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir Claude' }));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenCalledWith('https://claude.ai/settings/connectors', { presentationStyle: 'pageSheet' }));
  });

  test('an unused link is reused on a new visit; "Crear enlace nuevo" revokes the unused ones first', async () => {
    mockState.tokens = [
      { ...createdToken('mcp').token, id: 'old', createdAt: '2026-10-20T10:00:00Z' },
      { ...createdToken('mcp').token, id: 'recent', createdAt: '2026-10-26T10:00:00Z' },
    ];
    await render(<ConnectClaudeScreen />);
    expect(screen.getByText(/Ya tienes un enlace sin estrenar/)).toBeTruthy();
    expect(screen.getByText(/Esperando a que Claude se conecte/)).toBeTruthy();
    expect(mockCreateToken).not.toHaveBeenCalled();
    expect(mockSetString).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear enlace nuevo' }));
    await waitFor(() => expect(mockCreateToken).toHaveBeenCalledTimes(1));
    expect(mockRevokeToken.mock.calls.map((c) => c[0])).toEqual(['old', 'recent']);
    expect(await screen.findByText('https://x.supabase.co/functions/v1/mcp/u/rb_0123456789abcdef')).toBeTruthy();
  });

  test('already connected: success state, example prompts and active links', async () => {
    mockState.tokens = [{ ...createdToken('mcp').token, lastUsedAt: new Date().toISOString() }, { ...createdToken('ics').token, id: 't2' }];
    await render(<ConnectClaudeScreen />);
    expect(screen.getByText('Claude ya ve tu plan')).toBeTruthy();
    expect(mockCreateToken).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Revocar' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Copiar: Planifica mi semana/ })).toBeTruthy();
  });

  test('demo mode simulates the connection', async () => {
    mockState.mode = 'demo';
    await render(<ConnectClaudeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Crear mi enlace' }));
    expect(await screen.findByText(/Modo demo: simulamos que Claude se conecta/)).toBeTruthy();
  });

  test('with the AI coach off there is no comparison with it and no Anthropic consent link', async () => {
    await render(<ConnectClaudeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Crear mi enlace' }));
    expect(await screen.findByText(/Nombre: Road to Ironman/)).toBeTruthy();
    expect(screen.queryByText('¿Y el Coach IA de la app?')).toBeNull();
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
  test('connects Garmin with a typed key and a 1-year expiry', async () => {
    await render(<IntegrationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ya tengo la clave copiada' }));
    expect(screen.getByRole('button', { name: 'Pegar clave' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '¿No se pega? Escríbela a mano' }));
    await fireEvent.changeText(screen.getByPlaceholderText('Pega aquí tu clave'), '  abcdefghijklmnopqrstuvwxyz  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Conectar' }));
    await waitFor(() => expect(mockConnectGarmin).toHaveBeenCalledTimes(1));
    const vars = mockConnectGarmin.mock.calls[0]?.[0];
    expect(vars?.apiKey).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(vars?.expiresAt).toBe(addDays(todayISO(), 365));
    expect(screen.getByText('Clases')).toBeTruthy();
  });

  test('opens Garmin Connect in the in-app browser', async () => {
    await render(<IntegrationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir Garmin Connect' }));
    await waitFor(() =>
      expect(mockOpenBrowser).toHaveBeenCalledWith('https://connect.garmin.com/app/settings/personalApiToken', { presentationStyle: 'pageSheet' }),
    );
    expect(await screen.findByText('¿Ya has copiado la clave?')).toBeTruthy();
  });

  test('training calendar: turning it on enables the sync', async () => {
    await render(<IntegrationsScreen />);
    await fireEvent(screen.getByLabelText('Añadir mis entrenos al calendario'), 'valueChange', true);
    await waitFor(() => expect(mockTraining.enable).toHaveBeenCalledTimes(1));
  });

  test('training calendar on: alarm chips and "Sincronizar ahora"', async () => {
    mockTraining.enabled = true;
    await render(<IntegrationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '15 min' }));
    await waitFor(() => expect(mockTraining.setAlarmMinutes).toHaveBeenCalledWith(15));
    await fireEvent.press(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    await waitFor(() => expect(mockTraining.syncNow).toHaveBeenCalledTimes(1));
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
    expect(screen.getByText(/se envía a Cloudflare \(Workers AI\) para planificar/)).toBeTruthy();
  });

  test('in demo mode any key connects Garmin (simulated)', async () => {
    mockState.mode = 'demo';
    await render(<IntegrationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ya tengo la clave copiada' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Usar una clave de prueba (demo)' }));
    await waitFor(() => expect(mockConnectGarmin).toHaveBeenCalledTimes(1));
    expect(mockConnectGarmin.mock.calls[0]?.[0]?.apiKey).toBe('demo-personal-api-key-road-to-ironman');
  });
});

describe('Tu reloj › COROS', () => {
  test('Conexiones: switching to COROS saves it and swaps the Garmin and Apple Salud cards for the COROS one', async () => {
    await render(<IntegrationsScreen />);
    expect(screen.getByRole('button', { name: 'Abrir Garmin Connect' })).toBeTruthy();
    expect(screen.getByText('Apple Salud')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'COROS' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ watchBrand: 'coros' }));
    expect(await screen.findByRole('button', { name: 'Conectar Apple Salud' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abrir Garmin Connect' })).toBeNull();
    expect(screen.queryByText('Apple Salud')).toBeNull();
  });

  test('COROS card, Apple Salud off: the steps in the COROS app and a 4-week first import', async () => {
    mockState.profile = { ...mockProfile, watchBrand: 'coros' };
    await render(<IntegrationsScreen />);
    expect(screen.getByText(/Perfil › Ajustes › Apps de terceros › Sincronización de datos › Apple Health/)).toBeTruthy();
    expect(screen.getByText('Sin conectar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Conectar Apple Salud' }));
    await waitFor(() => expect(mockHealth.connect).toHaveBeenCalledWith({ days: 28 }));
    expect(await screen.findByText('12 entrenos y 26 noches de sueño de tus últimas 4 semanas.')).toBeTruthy();
  });

  test('COROS card, connected: last read, «Sincronizar» and the step-by-step guide', async () => {
    mockState.profile = { ...mockProfile, watchBrand: 'coros' };
    mockHealth.enabled = true;
    mockHealth.sources = ['COROS'];
    mockHealth.lastSync = new Date().toISOString();
    await render(<IntegrationsScreen />);
    expect(screen.getByText(/^Última lectura .+ · por Apple Salud$/)).toBeTruthy();
    // The COROS card comes first (the busy-calendar card has its own «Sincronizar»).
    await fireEvent.press(screen.getAllByRole('button', { name: 'Sincronizar' })[0]!);
    await waitFor(() => expect(mockHealth.syncNow).toHaveBeenCalledWith({ days: 28 }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guía paso a paso' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/coros');
  });

  test('COROS card, Apple Salud on but nothing from COROS: what to check', async () => {
    mockState.profile = { ...mockProfile, watchBrand: 'coros' };
    mockHealth.enabled = true;
    mockHealth.sources = ['Salud'];
    await render(<IntegrationsScreen />);
    expect(screen.getByText('Esperando datos')).toBeTruthy();
    expect(screen.getByText(/Aún no vemos datos de COROS/)).toBeTruthy();
    expect(screen.getByText(/Salud › tu foto › Apps › COROS/)).toBeTruthy();
  });

  test('the complete guide: five sections, copyable prompts and connector URLs', async () => {
    mockState.profile = { ...mockProfile, watchBrand: 'coros' };
    await render(<CorosGuideScreen />);
    for (const title of [
      'Apple Salud (automático)',
      'Tu Claude con COROS (recomendado)',
      'Tus entrenos en el reloj',
      'Mismos umbrales en las dos apps',
      'Si algo falla',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText(/Perfil › Biblioteca de entrenamientos › «\+»/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Copiar: Guarda en Road to Ironman mi sueño, VFC y recuperación de COROS/ }));
    await waitFor(() =>
      expect(mockSetString).toHaveBeenCalledWith('Guarda en Road to Ironman mi sueño, VFC y recuperación de COROS de anoche'),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Copiar Europa: https://mcpeu.coros.com/mcp' }));
    await waitFor(() => expect(mockSetString).toHaveBeenLastCalledWith('https://mcpeu.coros.com/mcp'));
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir tu perfil' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
  });

  test('Conecta tu Claude for a COROS athlete: the COROS connector and COROS prompts', async () => {
    mockState.profile = { ...mockProfile, watchBrand: 'coros' };
    mockState.tokens = [{ ...createdToken('mcp').token, lastUsedAt: new Date().toISOString() }];
    await render(<ConnectClaudeScreen />);
    expect(screen.getByText('Tu Claude puede leer tu COROS. Ahora también tu semana.')).toBeTruthy();
    expect(screen.getByText('Añade también COROS a tu Claude')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Copiar: Planifica mi semana en Road to Ironman con mis datos de COROS/ })).toBeTruthy();
    expect(screen.queryByText(/Body Battery/)).toBeNull();
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
