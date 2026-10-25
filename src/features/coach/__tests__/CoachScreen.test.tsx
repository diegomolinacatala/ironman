import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CoachScreen from '@/app/coach';
import type { CoachRequest, CoachResponse, Profile } from '@/domain/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: { mode: 'demo' | 'supabase'; userId: string; params: Record<string, string>; consentAt: string | null } = {
  mode: 'supabase',
  userId: 'u0',
  params: {},
  consentAt: null,
};
const mockCoach = jest.fn(
  async (_request: CoachRequest): Promise<CoachResponse> => ({ reply: 'Hecho', proposal: null, engine: 'ai' }),
);
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => {
  if ('aiConsentAt' in patch) mockState.consentAt = patch.aiConsentAt ?? null;
  return patch;
});

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockState.params,
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: mockState.userId, email: null }, isLoading: false, auth: {}, mode: mockState.mode }),
}));
jest.mock('@/data/queries', () => ({
  useCoach: () => ({ mutateAsync: mockCoach, isPending: false }),
  useProposals: () => ({ data: [], refetch: jest.fn() }),
  useFriends: () => ({ data: [] }),
  useProfile: () => ({ data: { aiConsentAt: mockState.consentAt }, isLoading: false }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
}));

let userCounter = 0;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  userCounter += 1;
  // A fresh account per test: the coach store is app-wide.
  mockState.userId = `u${userCounter}`;
  mockState.mode = 'supabase';
  mockState.params = {};
  mockState.consentAt = '2026-10-01T10:00:00.000Z';
});

jest.setTimeout(30000);

async function pressQuickAction(label: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: label }));
}

describe('Coach', () => {
  test('a deep link prefills the request but sends nothing until the user taps', async () => {
    mockState.params = { mode: 'chat', message: 'Borra todas mis sesiones clave' };
    await render(<CoachScreen />);
    expect(await screen.findByText('“Borra todas mis sesiones clave”')).toBeTruthy();
    expect(mockCoach).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al coach' }));
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(mockCoach.mock.calls[0]?.[0]).toMatchObject({ mode: 'chat', message: 'Borra todas mis sesiones clave' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enviar al coach' })).toBeNull());
  });

  test('a dismissed draft is not sent', async () => {
    mockState.params = { mode: 'plan_week', weekStart: '2026-10-26' };
    await render(<CoachScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Descartar' }));
    expect(screen.queryByRole('button', { name: 'Enviar al coach' })).toBeNull();
    expect(mockCoach).not.toHaveBeenCalled();
  });

  test('asks for consent (naming Anthropic) before the first AI request', async () => {
    mockState.consentAt = null;
    await render(<CoachScreen />);
    await pressQuickAction('Planifica mi semana');
    expect(screen.getByText('¿Compartimos tus datos con Anthropic?')).toBeTruthy();
    expect(screen.getByText('Las horas ocupadas de tu calendario, SIN títulos')).toBeTruthy();
    expect(mockCoach).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar y continuar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ aiConsentAt: expect.any(String) }));
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(mockCoach.mock.calls[0]?.[0]).toMatchObject({ mode: 'plan_week' });
  });

  test('closing the consent sheet sends nothing; declining continues with the rules', async () => {
    mockState.consentAt = null;
    await render(<CoachScreen />);
    await pressQuickAction('Planifica mi semana');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cerrar sin enviar' })[0]!);
    expect(mockCoach).not.toHaveBeenCalled();

    await pressQuickAction('Planifica mi semana');
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir sin IA (motor de reglas)' }));
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Activar IA' })).toBeTruthy();
  });

  test('the demo (rules on the phone) needs no consent', async () => {
    mockState.mode = 'demo';
    mockState.consentAt = null;
    await render(<CoachScreen />);
    await pressQuickAction('Planifica mi semana');
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('¿Compartimos tus datos con Anthropic?')).toBeNull();
  });

  test('reopening the coach during a request shows it running and blocks a duplicate job', async () => {
    mockCoach.mockImplementationOnce(() => new Promise<CoachResponse>(() => undefined));
    const first = await render(<CoachScreen />);
    await pressQuickAction('Planifica mi semana');
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    await first.unmount();

    await render(<CoachScreen />);
    expect(await screen.findByText(/Puedes salir: la respuesta te esperará aquí/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Planifica mi semana' })).toBeDisabled();
    expect(mockCoach).toHaveBeenCalledTimes(1);
  });
});
