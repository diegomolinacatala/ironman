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
  mode: 'demo' | 'supabase';
} = { profile: null, integrations: [], stored: {}, clipboard: '', mode: 'supabase' };

/** The profile lives in a tiny store too: saving it (e.g. "Tu reloj") re-renders the screen, as React Query does. */
const mockProfileStore = {
  listeners: new Set<() => void>(),
  set(profile: Profile) {
    mockState.profile = profile;
    this.listeners.forEach((l) => l());
  },
};

const COROS_RESULT = { metricsDays: 26, sleepNights: 26, activitiesFound: 12, workoutsCompleted: 3, activitiesImported: 9, sources: ['COROS'] };
const NOTHING_FROM_COROS = { metricsDays: 3, sleepNights: 0, activitiesFound: 0, workoutsCompleted: 0, activitiesImported: 0, sources: ['Salud'] };

/** Apple Salud on this device (how a COROS watch reaches us). `connect` turns it on, as the real hook does. */
const mockHealth = {
  available: true,
  loaded: true,
  enabled: false,
  lastSync: null as string | null,
  sources: [] as string[],
  busy: false,
  connect: jest.fn(async (_opts?: { days?: number }): Promise<typeof COROS_RESULT | null> => {
    mockHealth.enabled = true;
    return COROS_RESULT;
  }),
  syncNow: jest.fn(async (_opts?: { days?: number }) => COROS_RESULT),
  disable: jest.fn(async () => undefined),
};

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

const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => {
  if (mockState.profile) mockProfileStore.set({ ...mockState.profile, ...patch });
  return mockState.profile;
});
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
  useAuth: () => ({ session: { userId: 'u1', email: 'd@x.es' }, isLoading: false, auth: {}, mode: mockState.mode }),
}));
jest.mock('@/data/queries', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const mutation = <T,>(fn: T) => ({ mutateAsync: fn, isPending: false });
  const query = <T,>(data: T) => ({ data, isLoading: false, isError: false, refetch: jest.fn(async () => undefined) });
  return {
    useProfile: () => {
      const data = useSyncExternalStore(
        (l: () => void) => {
          mockProfileStore.listeners.add(l);
          return () => mockProfileStore.listeners.delete(l);
        },
        () => mockState.profile,
      );
      return { ...query(data), refetch: jest.fn() };
    },
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
  FIRST_HEALTH_IMPORT_DAYS: 28,
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
  useHealthIntegration: () => ({ ...mockHealth }),
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
  mockState.mode = 'supabase';
  mockProfileStore.listeners.clear();
  mockTokenStore.tokens = [];
  mockTokenStore.listeners.clear();
  mockHealth.available = true;
  mockHealth.loaded = true;
  mockHealth.enabled = false;
  mockHealth.sources = [];
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
    expect(screen.getByText('Lee tu reloj')).toBeTruthy();
    // The welcome step introduces the brand mark instead of a generic icon tile.
    expect(screen.getByTestId('brand-mark', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /^Paso 1 de \d+$/ })).toBeTruthy();
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
    expect(screen.getByTestId('success-check')).toBeTruthy();
    expect(screen.queryByTestId('brand-mark', { includeHiddenElements: true })).toBeNull();
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
    // Friday–Sunday the first plan also covers next week (weeksToPlan): one session per planned week.
    const sessions = weeksToPlan(todayISO()).length;
    expect(screen.getByText(sessions === 1 ? /1 sesión en los próximos días/ : new RegExp(`${sessions} sesiones en los próximos días`))).toBeTruthy();
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
    await press('Seguir sin reloj');
    expect(await screen.findByText('Conecta tu Claude')).toBeTruthy();
    expect(mockState.stored['rti.onboarding.v2.u1']).toMatchObject({ step: 'claude', garminSkipped: true });
    warn.mockRestore();
  });

  test('"Seguir sin reloj" also appears after 45 s on the step', async () => {
    mockState.stored['rti.onboarding.v2.u1'] = { version: 2, step: 'garmin', claudeDone: false };
    jest.useFakeTimers();
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Conecta tu Garmin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seguir sin reloj' })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(45_000);
    });
    expect(screen.getByRole('button', { name: 'Seguir sin reloj' })).toBeTruthy();
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

describe('Tu reloj › COROS', () => {
  const KEY = 'rti.onboarding.v2.u1';

  test('choosing COROS saves it; Apple Salud imports 4 weeks; the Claude step adds the COROS connector', async () => {
    mockState.profile = baseProfile({ aiConsentAt: '2026-10-27T08:00:00Z' });
    mockState.stored[KEY] = { version: 2, step: 'garmin', claudeDone: false };
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Conecta tu Garmin')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'COROS' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ watchBrand: 'coros' }));
    expect(await screen.findByText('Conecta tu COROS')).toBeTruthy();
    expect(screen.getByText(/Perfil › Ajustes › Apps de terceros › Sincronización de datos › Apple Health/)).toBeTruthy();
    expect(screen.getByText(/La VFC, la recuperación y la carga de COROS llegan a través de tu Claude/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();

    await press('Conectar Apple Salud');
    await waitFor(() => expect(mockHealth.connect).toHaveBeenCalledWith({ days: 28 }));
    expect(await screen.findByText('COROS conectado')).toBeTruthy();
    expect(screen.getByText('12 entrenos y 26 noches de sueño de tus últimas 4 semanas.')).toBeTruthy();
    await press('Continuar');

    expect(await screen.findByText('Añade también COROS a tu Claude')).toBeTruthy();
    expect(screen.getByText('https://mcp.coros.com/mcp')).toBeTruthy();
    expect(screen.getByText('https://mcpeu.coros.com/mcp')).toBeTruthy();
    expect(screen.getByText('Permitir siempre')).toBeTruthy();
    expect(screen.getByText('Bloqueado')).toBeTruthy();
    expect(mockState.stored[KEY]).toMatchObject({ step: 'claude', garminSkipped: false });
  });

  test('nothing from COROS yet: what to check, «Comprobar otra vez», and the step is already done', async () => {
    mockState.profile = baseProfile({ watchBrand: 'coros' });
    mockState.stored[KEY] = { version: 2, step: 'garmin', claudeDone: false };
    mockHealth.connect.mockImplementationOnce(async () => {
      mockHealth.enabled = true;
      return NOTHING_FROM_COROS;
    });
    await render(<OnboardingScreen />);
    await press('Conectar Apple Salud');
    expect(await screen.findByText('Aún no vemos datos de COROS')).toBeTruthy();
    expect(screen.getByText(/Salud › tu foto › Apps › COROS/)).toBeTruthy();
    expect(screen.getByText(/Salud › tu foto › Apps › Road to Ironman/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeTruthy();
    await press('Comprobar otra vez');
    await waitFor(() => expect(mockHealth.syncNow).toHaveBeenCalledWith({ days: 28 }));
    expect(await screen.findByText('COROS conectado')).toBeTruthy();
  });

  test('resume waits for the Apple Salud opt-in: on → never sent back to "Tu reloj"', async () => {
    mockState.profile = baseProfile({ watchBrand: 'coros' });
    mockState.stored[KEY] = { version: 2, step: 'calendar', claudeDone: true };
    mockHealth.loaded = false;
    const view = await render(<OnboardingScreen />);
    expect(screen.getByLabelText('Preparando tu bienvenida')).toBeTruthy();
    mockHealth.loaded = true;
    mockHealth.enabled = true;
    await view.rerender(<OnboardingScreen />);
    expect(await screen.findByText('Tu plan, en tu calendario')).toBeTruthy();
  });

  test('resume with Apple Salud off goes back to "Conecta tu COROS"', async () => {
    mockState.profile = baseProfile({ watchBrand: 'coros' });
    mockState.stored[KEY] = { version: 2, step: 'calendar', claudeDone: true };
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Conecta tu COROS')).toBeTruthy();
  });

  test('a failed connection offers «Seguir sin reloj» right away', async () => {
    mockState.profile = baseProfile({ watchBrand: 'coros' });
    mockState.stored[KEY] = { version: 2, step: 'garmin', claudeDone: false };
    mockHealth.connect.mockRejectedValueOnce(new Error('No se pudo pedir acceso a Apple Salud. Revisa Ajustes > Salud > Road to Ironman.'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<OnboardingScreen />);
    expect(screen.queryByRole('button', { name: 'Seguir sin reloj' })).toBeNull();
    await press('Conectar Apple Salud');
    expect(await screen.findByText(/No se pudo pedir acceso a Apple Salud/)).toBeTruthy();
    confirmEverything();
    await press('Seguir sin reloj');
    expect(await screen.findByText('Conecta tu Claude')).toBeTruthy();
    expect(mockState.stored[KEY]).toMatchObject({ step: 'claude', garminSkipped: true });
    warn.mockRestore();
  });

  test('signed in without Apple Salud (web): «Solo en el iPhone» and the way out at once', async () => {
    mockState.profile = baseProfile({ watchBrand: 'coros' });
    mockState.stored[KEY] = { version: 2, step: 'garmin', claudeDone: false };
    mockHealth.available = false;
    await render(<OnboardingScreen />);
    expect(await screen.findByText('Solo en el iPhone')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Conectar Apple Salud' })).toBeNull();
    confirmEverything();
    await press('Seguir sin reloj');
    expect(await screen.findByText('Conecta tu Claude')).toBeTruthy();
  });

  test('the web demo simulates COROS like the other steps, and resume keeps it', async () => {
    mockState.mode = 'demo';
    mockState.profile = baseProfile({ watchBrand: 'coros' });
    mockState.stored[KEY] = { version: 2, step: 'garmin', claudeDone: false };
    mockHealth.available = false;
    await render(<OnboardingScreen />);
    await press('Conectar Apple Salud');
    expect(await screen.findByText(/Modo demo: simulamos que COROS ha traído/)).toBeTruthy();
    expect(mockHealth.connect).not.toHaveBeenCalled();
    await press('Continuar');
    expect(await screen.findByText('Conecta tu Claude')).toBeTruthy();
    expect(mockState.stored[KEY]).toMatchObject({ step: 'claude', garminSkipped: true });
  });
});
