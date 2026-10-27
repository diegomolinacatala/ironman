import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import OnboardingScreen from '@/app/onboarding';
import { addDays, todayISO } from '@/domain/dates';
import { weeksToPlan } from '@/features/onboarding/planSummary';
import type { IntegrationStatus, PersonalToken, Profile } from '@/domain/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: {
  profile: Profile | null;
  integrations: IntegrationStatus[];
  stored: Record<string, unknown>;
  clipboard: string;
} = { profile: null, integrations: [], stored: {}, clipboard: '' };

/** Tokens live in a tiny store so the polling screen re-renders when one gets used. */
const mockTokenStore = {
  tokens: [] as PersonalToken[],
  listeners: new Set<() => void>(),
  set(tokens: PersonalToken[]) {
    this.tokens = tokens;
    this.listeners.forEach((l) => l());
  },
};

const NEW_TOKEN: PersonalToken = {
  id: 'tNew',
  scope: 'mcp',
  label: 'Claude',
  prefix: 'rb_abc',
  createdAt: '2026-10-27T08:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
};
const CONNECTOR_URL = 'https://x.supabase.co/functions/v1/mcp/u/rb_secret';

const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => ({ ...mockState.profile, ...patch }));
const mockConnectGarmin = jest.fn(async (_vars: { apiKey: string; expiresAt: string | null }) => ({}));
const mockCreateToken = jest.fn(async (_vars: { scope: string; label: string }) => {
  mockTokenStore.set([...mockTokenStore.tokens, NEW_TOKEN]);
  return { token: NEW_TOKEN, secret: 'rb_secret', url: CONNECTOR_URL };
});
const mockCoach = jest.fn(async (_req: Record<string, unknown>) => ({
  reply: 'ok',
  engine: 'rules',
  memory: [],
  lifeEvent: null,
  proposal: {
    id: 'p1',
    changes: [
      {
        op: 'add',
        reason: 'plan',
        workout: { date: addDays(todayISO(), 1), sport: 'run', title: 'Rodaje suave', durationMin: 50, intensity: 'endurance', isKey: true },
      },
    ],
  },
}));
const mockApply = jest.fn(async (_vars: Record<string, unknown>) => ({ applied: 1, failed: [], workouts: [] }));
const mockSetString = jest.fn(async (_text: string) => true);
const mockOpenBrowser = jest.fn(async (_url: string, _opts?: unknown) => ({ type: 'dismiss' }));
const mockEnable = jest.fn(async () => true);

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
jest.mock('expo-clipboard', () => ({
  isPasteButtonAvailable: false,
  ClipboardPasteButton: () => null,
  setStringAsync: (text: string) => mockSetString(text),
  getStringAsync: async () => mockState.clipboard,
}));
jest.mock('expo-web-browser', () => ({
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
  openBrowserAsync: (url: string, opts?: unknown) => mockOpenBrowser(url, opts),
}));
jest.mock('@/lib/storage', () => ({
  readJson: async (key: string, fallback: unknown) => (key in mockState.stored ? mockState.stored[key] : fallback),
  writeJson: async (key: string, value: unknown) => {
    mockState.stored[key] = value;
  },
  removeKey: async (key: string) => {
    delete mockState.stored[key];
  },
}));
jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'u1', email: 'd@x.es' }, isLoading: false, auth: {}, mode: 'supabase' }),
}));
jest.mock('@/data/queries', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const mutation = <T,>(fn: T) => ({ mutateAsync: fn, isPending: false });
  const query = <T,>(data: T) => ({ data, isLoading: false, isError: false, refetch: jest.fn(async () => undefined) });
  return {
    useProfile: () => ({ ...query(mockState.profile), refetch: jest.fn() }),
    useUpdateProfile: () => mutation(mockUpdateProfile),
    useRaces: () => query([]),
    useCreateRace: () => mutation(jest.fn()),
    useUpdateRace: () => mutation(jest.fn()),
    useIntegrations: () => query(mockState.integrations),
    useConnectGarmin: () => mutation(mockConnectGarmin),
    useMetrics: () => query([]),
    useWorkouts: () => query([]),
    useTokens: () => {
      const data = useSyncExternalStore(
        (l: () => void) => {
          mockTokenStore.listeners.add(l);
          return () => mockTokenStore.listeners.delete(l);
        },
        () => mockTokenStore.tokens,
      );
      return query(data);
    },
    useCreateToken: () => mutation(mockCreateToken),
    useRevokeToken: () => mutation(jest.fn(async () => undefined)),
    useCoach: () => mutation(mockCoach),
    useApplyPlanChanges: () => mutation(mockApply),
  };
});
jest.mock('@/integrations/hooks', () => ({
  useNotificationPermission: () => ({ status: 'granted', request: async () => true }),
  useCalendarIntegration: () => ({
    permission: 'undetermined',
    calendars: [],
    selectedIds: [],
    lastSync: null,
    busy: false,
    request: async () => undefined,
    setSelected: async () => undefined,
    syncNow: async () => undefined,
  }),
}));
jest.mock('@/integrations/calendar', () => ({ getCalendarPermission: async () => 'granted' }));
jest.mock('@/integrations/calendar/trainingCalendar', () => ({
  useTrainingCalendar: () => ({
    available: true,
    permission: 'undetermined',
    enabled: false,
    calendarTitle: null,
    alarmMinutes: 30,
    lastSync: null,
    busy: false,
    error: null,
    enable: mockEnable,
    disable: async () => undefined,
    setAlarmMinutes: async () => undefined,
    syncNow: async () => undefined,
  }),
}));

jest.setTimeout(30000);

function baseProfile(patch: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    username: 'diego',
    displayName: 'Diego',
    avatarUrl: null,
    sports: ['swim', 'bike', 'run'],
    level: 'intermediate',
    thresholds: {},
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
    coachNotes: null,
    onboardedAt: null,
    aiConsentAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...patch,
  };
}

async function press(name: string | RegExp): Promise<void> {
  await fireEvent.press(await screen.findByRole('button', { name }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.profile = baseProfile();
  mockState.integrations = [];
  mockState.stored = {};
  mockState.clipboard = '';
  mockTokenStore.tokens = [];
  mockTokenStore.listeners.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Native confirmations (Alert.alert) answered with the confirm button. */
function confirmEverything(): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.[1]?.onPress?.();
  });
}

describe('v2 onboarding', () => {
  test('walks every step: Garmin and Claude connected, first plan applied, then Hoy', async () => {
    mockState.clipboard = '  garmin-personal-api-key-1234567890  ';
    await render(<OnboardingScreen />);

    // 1 · Bienvenida (prefilled name)
    expect(await screen.findByText('Tu coach de bolsillo')).toBeTruthy();
    expect(screen.getByDisplayValue('Diego')).toBeTruthy();
    expect(screen.getByText('Lee tu Garmin')).toBeTruthy();
    await press('Empezar');

    // 2 · Objetivo
    expect(await screen.findByText('¿A por qué vamos?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Aún no tengo carrera' }));
    await press('Siguiente');
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith(expect.objectContaining({ sports: ['swim', 'bike', 'run'] })));

    // 3 · Garmin: no "Continuar" until connected
    expect(await screen.findByText('Conecta tu Garmin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    await press('Abrir Garmin Connect');
    expect(mockOpenBrowser).toHaveBeenCalledWith('https://connect.garmin.com/app/settings/personalApiToken', { presentationStyle: 'pageSheet' });
    await press('Pegar clave');
    await waitFor(() => expect(mockConnectGarmin).toHaveBeenCalledTimes(1));
    expect(mockConnectGarmin.mock.calls[0]?.[0]).toEqual({ apiKey: 'garmin-personal-api-key-1234567890', expiresAt: addDays(todayISO(), 365) });
    expect(await screen.findByText('Garmin conectado')).toBeTruthy();
    await press('Continuar');

    // 4 · Claude: consent, then the link is created and copied, then live verification
    expect(await screen.findByText('Antes, tu permiso')).toBeTruthy();
    expect(screen.getAllByText(/Cloudflare/).length).toBeGreaterThan(0);
    await press('Acepto');
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ aiConsentAt: expect.any(String) }));
    await waitFor(() => expect(mockCreateToken).toHaveBeenCalledWith({ scope: 'mcp', label: 'Claude' }));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith(CONNECTOR_URL));
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    await press('Abrir Claude');
    expect(mockOpenBrowser).toHaveBeenLastCalledWith('https://claude.ai/settings/connectors', { presentationStyle: 'pageSheet' });
    await act(async () => mockTokenStore.set([{ ...NEW_TOKEN, lastUsedAt: new Date().toISOString() }]));
    expect(await screen.findByText('Claude ya ve tu plan')).toBeTruthy();
    await press('Continuar');

    // 5 · Calendario and 6 · Informe (optional)
    expect(await screen.findByText('Tu plan, en tu calendario')).toBeTruthy();
    await press('Ahora no');
    expect(await screen.findByText('Tu informe de cada mañana')).toBeTruthy();
    await press('Activar mi informe');
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        notificationPrefs: expect.objectContaining({ morningSummary: true, morningTime: '07:00' }),
      }),
    );

    // 7 · Plan: generated with the coach, applied automatically, summary, then Hoy
    expect(await screen.findByText('Tu plan está listo')).toBeTruthy();
    expect(mockCoach).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan_week' }));
    expect(mockApply).toHaveBeenCalledWith({ changes: expect.any(Array), proposalId: 'p1' });
    expect(screen.getByText(/1 sesión en los próximos días/)).toBeTruthy();
    await press('Empezar');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(mockUpdateProfile).toHaveBeenLastCalledWith({ onboardedAt: expect.any(String) });
    expect(mockState.stored['rti.onboarding.v2.u1']).toBeUndefined();
  });

  test('resumes at the saved step, but never past a required step that is no longer done', async () => {
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'morning', claudeDone: true };
    await render(<OnboardingScreen />);
    // Garmin is not connected (anymore): back to the Garmin step.
    expect(await screen.findByText('Conecta tu Garmin')).toBeTruthy();
    expect(screen.getByLabelText('Paso 3 de 7')).toBeTruthy();
  });

  test('resumes where the athlete left it when everything before is done', async () => {
    mockState.integrations = [{ provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null }];
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'calendar', claudeDone: true };
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Tu plan, en tu calendario')).toBeTruthy();
    await press('Atrás');
    expect(await screen.findByText('Conecta tu Claude')).toBeTruthy();
    await waitFor(() => expect(mockState.stored['rti.onboarding.v2.u1']).toMatchObject({ step: 'claude' }));
  });

  test('a rejected Garmin key explains how to fix it and keeps the step locked', async () => {
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'garmin', claudeDone: false };
    mockConnectGarmin.mockRejectedValueOnce(new Error('Garmin no acepta esta clave.'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<OnboardingScreen />);
    await press('Ya tengo la clave copiada');
    await press('¿No se pega? Escríbela a mano');
    await fireEvent.changeText(screen.getByPlaceholderText('Pega aquí tu clave'), 'abcdefghijklmnopqrstuvwxyz');
    await press('Conectar');
    expect(await screen.findByText('La clave no es válida o ha caducado: crea una nueva y vuelve a copiarla.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    // A failed attempt opens the discreet way out.
    confirmEverything();
    await press('Seguir sin Garmin');
    expect(await screen.findByText('Conecta tu Claude')).toBeTruthy();
    expect(mockState.stored['rti.onboarding.v2.u1']).toMatchObject({ step: 'claude', garminSkipped: true });
    warn.mockRestore();
  });

  test('"Seguir sin Garmin" also appears after 45 s on the step', async () => {
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'garmin', claudeDone: false };
    jest.useFakeTimers();
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Conecta tu Garmin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seguir sin Garmin' })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(45_000);
    });
    expect(screen.getByRole('button', { name: 'Seguir sin Garmin' })).toBeTruthy();
  });

  test('a skipped Garmin does not send the athlete back on resume', async () => {
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'calendar', claudeDone: true, garminSkipped: true };
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Tu plan, en tu calendario')).toBeTruthy();
  });

  test('after a restart the recent unused Claude link is reused, not minted again', async () => {
    mockState.profile = baseProfile({ aiConsentAt: '2026-10-27T08:00:00Z' });
    mockState.integrations = [{ provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null }];
    mockTokenStore.tokens = [{ ...NEW_TOKEN, id: 'tRecent', createdAt: new Date(Date.now() - 2 * 60_000).toISOString() }];
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'claude', claudeDone: false, claudeTokenId: 'tRecent' };
    await render(<OnboardingScreen />);
    expect(await screen.findByText(/Ya tienes un enlace sin estrenar/)).toBeTruthy();
    expect(screen.getByText(/Esperando a que Claude se conecte/)).toBeTruthy();
    expect(mockCreateToken).not.toHaveBeenCalled();
    expect(mockSetString).not.toHaveBeenCalled();
    await act(async () => mockTokenStore.set([{ ...mockTokenStore.tokens[0]!, lastUsedAt: new Date().toISOString() }]));
    expect(await screen.findByText('Claude ya ve tu plan')).toBeTruthy();
  });

  test('weeks already planned are never generated or applied again (restart on the plan step)', async () => {
    mockState.integrations = [{ provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null }];
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'plan', claudeDone: true, plannedWeeks: weeksToPlan(todayISO()) };
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Tu plan está listo')).toBeTruthy();
    expect(mockCoach).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  test('a retry after a partial failure only plans the weeks still missing (Friday: two weeks)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T10:00:00') });
    mockState.integrations = [{ provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null }];
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'plan', claudeDone: true };
    const firstCall = mockCoach.getMockImplementation();
    mockCoach.mockImplementationOnce(async (req) => firstCall!(req)).mockRejectedValueOnce(new Error('Sin conexión'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<OnboardingScreen />);
    await press('Reintentar');
    expect(await screen.findByText('Tu plan está listo')).toBeTruthy();
    expect(mockCoach.mock.calls.map((c) => c[0]?.weekStart)).toEqual(['2026-10-26', '2026-11-02', '2026-11-02']);
    expect(mockApply).toHaveBeenCalledTimes(2);
    expect(mockState.stored['rti.onboarding.v2.u1']).toMatchObject({ plannedWeeks: ['2026-10-26', '2026-11-02'] });
    warn.mockRestore();
  });

  test('"Saltar por ahora" appears only after 45 s waiting for Claude', async () => {
    mockState.profile = baseProfile({ aiConsentAt: '2026-10-27T08:00:00Z' });
    mockState.integrations = [{ provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null }];
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'claude', claudeDone: false };
    jest.useFakeTimers();
    await render(<OnboardingScreen />);
    await waitFor(() => expect(mockCreateToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Esperando a que Claude se conecte/)).toBeTruthy();
    expect(mockState.stored['rti.onboarding.v2.u1']).toMatchObject({ claudeTokenId: 'tNew' });
    expect(screen.queryByRole('button', { name: 'Saltar por ahora' })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(45_000);
    });
    await press('Saltar por ahora');
    expect(await screen.findByText('Tu plan, en tu calendario')).toBeTruthy();
    expect(mockState.stored['rti.onboarding.v2.u1']).toMatchObject({ step: 'calendar', claudeDone: true });
  });

  test('an already onboarded profile goes straight to Hoy', async () => {
    mockState.profile = baseProfile({ onboardedAt: '2026-10-01T10:00:00Z' });
    await render(<OnboardingScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(screen.queryByText('Tu coach de bolsillo')).toBeNull();
  });
});
