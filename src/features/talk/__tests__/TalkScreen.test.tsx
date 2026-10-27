import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import TalkScreen from '@/app/talk';
import type { ApplyResult, CoachRequest, CoachResponse, PlanProposal, Profile, ProposalStatus } from '@/domain/types';
import { makeCoachResponse, makeLifeEvent, makeProposal, makeWorkout } from '@/features/coach/__tests__/fixtures';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: { mode: 'demo' | 'supabase'; params: Record<string, string>; consentAt: string | null } = {
  mode: 'demo',
  params: {},
  consentAt: null,
};
const mockCoach = jest.fn(async (_request: CoachRequest): Promise<CoachResponse> => makeCoachResponse());
const mockApply = jest.fn(async (_vars: { changes: unknown[]; proposalId?: string }): Promise<ApplyResult> => ({ applied: 2, failed: [], workouts: [] }));
const mockSetStatus = jest.fn(async (_vars: { id: string; status: ProposalStatus }) => undefined);
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => patch);
const mockSpeak = jest.fn();
const mockWorkouts = [makeWorkout({ id: 'w1', title: 'Rodaje suave' }), makeWorkout({ id: 'w2', title: 'Series' })];
const mockVoice: VoiceInput = {
  state: 'idle',
  transcript: '',
  level: 0,
  error: null,
  available: true,
  start: jest.fn(async () => undefined),
  stop: jest.fn(),
  cancel: jest.fn(),
  reset: jest.fn(),
};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockState.params,
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/features/talk/motion', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    FadeIn: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    PulseRing: () => null,
    Shimmer: () => <View />,
  };
});
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, aiCoachEnabled: true } };
});
jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'me', email: null }, isLoading: false, auth: {}, mode: mockState.mode }),
}));
jest.mock('@/data/queries', () => ({
  useCoach: () => ({ mutateAsync: mockCoach, isPending: false }),
  useApplyPlanChanges: () => ({ mutateAsync: mockApply, isPending: false }),
  useSetProposalStatus: () => ({ mutateAsync: mockSetStatus, isPending: false }),
  useWorkouts: () => ({ data: mockWorkouts }),
  useProposal: () => ({ data: undefined }),
  useProfile: () => ({ data: { aiConsentAt: mockState.consentAt }, isLoading: false }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
}));
jest.mock('@/integrations/speech/useVoiceInput', () => ({ useVoiceInput: () => ({ ...mockVoice }) }));
jest.mock('@/integrations/speech/useSpeaker', () => ({
  useSpeaker: () => ({
    speaking: false,
    paused: false,
    progress: 0,
    voiceName: null,
    hasEnhancedVoice: true,
    speak: mockSpeak,
    pause: jest.fn(),
    resume: jest.fn(),
    stop: jest.fn(),
  }),
}));

const PROPOSAL: PlanProposal = makeProposal({
  id: 'p9',
  source: 'ai_coach',
  changes: [
    { op: 'delete', workoutId: 'w1', reason: 'Deja descansar el tobillo' },
    { op: 'move', workoutId: 'w2', toDate: '2026-10-30', reason: 'Mejor el viernes' },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mode = 'demo';
  mockState.params = {};
  mockState.consentAt = null;
  Object.assign(mockVoice, { state: 'idle', transcript: '', level: 0, error: null, available: true });
});

async function sendTyped(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Mensaje para tu coach'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar a tu coach' }));
}

describe('Talk — idle', () => {
  test('greets with examples and one big mic', async () => {
    await render(<TalkScreen />);
    expect(screen.getByText('¿Qué te cuentas?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Me he torcido el tobillo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hablar con tu coach' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Escribir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nueva conversación' })).toBeNull();
  });

  test('an example prefills the keyboard composer without sending', async () => {
    await render(<TalkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Prefiero nadar por la mañana' }));
    expect(screen.getByLabelText('Mensaje para tu coach').props.value).toBe('Prefiero nadar por la mañana');
    expect(mockCoach).not.toHaveBeenCalled();
  });

  test('without speech recognition it starts on the keyboard', async () => {
    mockVoice.available = false;
    await render(<TalkScreen />);
    expect(screen.getByLabelText('Mensaje para tu coach')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hablar con tu coach' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hablar' })).toBeNull();
  });

  test('the mic starts listening and a finished take is sent as voice', async () => {
    await render(<TalkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Hablar con tu coach' }));
    expect(mockVoice.start).toHaveBeenCalledTimes(1);

    Object.assign(mockVoice, { state: 'listening', transcript: 'me duele el tobillo' });
    await screen.rerender(<TalkScreen />);
    expect(screen.getByText('me duele el tobillo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Terminar de hablar' })).toBeTruthy();

    Object.assign(mockVoice, { state: 'idle' });
    await screen.rerender(<TalkScreen />);
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(mockCoach.mock.calls[0]?.[0]).toMatchObject({ mode: 'chat', message: 'me duele el tobillo', channel: 'voice' });
    expect(mockVoice.reset).toHaveBeenCalled();
  });

  test('switching to the keyboard mid-take discards it silently', async () => {
    Object.assign(mockVoice, { state: 'listening', transcript: 'mañana no' });
    await render(<TalkScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Escribir' }));
    expect(mockVoice.cancel).toHaveBeenCalled();

    Object.assign(mockVoice, { state: 'idle', transcript: '' });
    await screen.rerender(<TalkScreen />);
    expect(screen.getByLabelText('Mensaje para tu coach')).toBeTruthy();
    expect(screen.queryByText(/No te he oído/)).toBeNull();
    expect(mockCoach).not.toHaveBeenCalled();
  });

  test('a take that ends empty asks to try again', async () => {
    Object.assign(mockVoice, { state: 'listening', transcript: '' });
    await render(<TalkScreen />);
    Object.assign(mockVoice, { state: 'idle' });
    await screen.rerender(<TalkScreen />);
    expect(screen.getByText(/No te he oído/)).toBeTruthy();
    expect(mockCoach).not.toHaveBeenCalled();
  });

  test('a ?message link prefills; a replan link waits for a tap', async () => {
    mockState.params = { message: '¿Qué como antes del fondo?' };
    const first = await render(<TalkScreen />);
    expect(screen.getByLabelText('Mensaje para tu coach').props.value).toBe('¿Qué como antes del fondo?');
    await first.unmount();

    mockState.params = { mode: 'replan', lifeEventId: 'e1' };
    await render(<TalkScreen />);
    expect(screen.getByText('¿Se lo enviamos al coach?')).toBeTruthy();
    expect(mockCoach).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al coach' }));
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(mockCoach.mock.calls[0]?.[0]).toMatchObject({ mode: 'replan', lifeEventId: 'e1' });
  });
});

describe('Talk — result', () => {
  beforeEach(() => {
    mockVoice.available = false;
    mockCoach.mockImplementation(async () =>
      makeCoachResponse({
        reply: 'Quito el rodaje de hoy y paso las series al viernes. Consulta a un profesional si no mejora.',
        proposal: PROPOSAL,
        engine: 'rules',
        memory: ['Prefiere nadar por la mañana'],
        lifeEvent: makeLifeEvent(),
      }),
    );
  });

  test('shows the reply, what it remembered, the imprevisto and the changes', async () => {
    await render(<TalkScreen />);
    await sendTyped('Me he torcido el tobillo');
    expect(await screen.findByText(/Quito el rodaje de hoy/)).toBeTruthy();
    expect(mockCoach.mock.calls[0]?.[0]).toMatchObject({ message: 'Me he torcido el tobillo', channel: 'text' });
    expect(screen.getByLabelText('Lo recordaré: Prefiere nadar por la mañana')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apuntado: Esguince de tobillo' })).toBeTruthy();
    expect(screen.getByText('Respuesta automática (sin IA)')).toBeTruthy();
    expect(screen.getByText('Cambios en tu plan · 2 cambios')).toBeTruthy();
    expect(screen.getByText('Rodaje suave')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nueva conversación' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Escuchar' }));
    expect(mockSpeak).toHaveBeenCalledWith(expect.stringContaining('Quito el rodaje'));
    await fireEvent.press(screen.getByRole('button', { name: 'Apuntado: Esguince de tobillo' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/event/edit?id=e1');
  });

  test('"Aplicar cambios" applies the whole proposal and confirms', async () => {
    await render(<TalkScreen />);
    await sendTyped('Me he torcido el tobillo');
    await fireEvent.press(await screen.findByRole('button', { name: 'Aplicar cambios' }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith({ changes: PROPOSAL.changes, proposalId: 'p9' }));
    expect(await screen.findAllByText('Hecho: 2 cambios aplicados a tu plan.')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Aplicar cambios' })).toBeNull();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  test('"Ahora no" discards the proposal', async () => {
    await render(<TalkScreen />);
    await sendTyped('Me he torcido el tobillo');
    await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
    await waitFor(() => expect(mockSetStatus).toHaveBeenCalledWith({ id: 'p9', status: 'discarded' }));
    expect(await screen.findAllByText('Vale, dejo tu plan como estaba.')).not.toHaveLength(0);
    expect(mockApply).not.toHaveBeenCalled();
  });

  test('the next message carries the conversation so far', async () => {
    await render(<TalkScreen />);
    await sendTyped('Me he torcido el tobillo');
    await screen.findByText(/Quito el rodaje de hoy/);
    await sendTyped('¿Y el sábado?');
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(2));
    expect(mockCoach.mock.calls[1]?.[0].history).toEqual([
      { role: 'user', content: 'Me he torcido el tobillo' },
      { role: 'assistant', content: expect.stringContaining('Quito el rodaje') },
    ]);
  });
});

describe('Talk — waiting and consent', () => {
  beforeEach(() => {
    mockVoice.available = false;
  });

  test('a slow answer can be cancelled and the message comes back to the composer', async () => {
    mockCoach.mockImplementationOnce(() => new Promise<CoachResponse>(() => undefined));
    await render(<TalkScreen />);
    await sendTyped('Mañana no puedo entrenar por la tarde');
    expect(await screen.findByText('Entendiendo…')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Entendiendo…')).toBeNull();
    expect(screen.getByLabelText('Mensaje para tu coach').props.value).toBe('Mañana no puedo entrenar por la tarde');
  });

  test('an error offers a retry', async () => {
    mockCoach.mockRejectedValueOnce(new Error('Sin conexión'));
    await render(<TalkScreen />);
    await sendTyped('Hola');
    expect(await screen.findByText('Sin conexión')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(2));
  });

  test('with Supabase and no consent it asks before sending', async () => {
    mockState.mode = 'supabase';
    await render(<TalkScreen />);
    await sendTyped('Hola');
    expect(screen.getByText('¿Compartimos tus datos con Cloudflare?')).toBeTruthy();
    expect(mockCoach).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar y continuar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ aiConsentAt: expect.any(String) }));
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
  });

  test('with consent given it sends at once', async () => {
    mockState.mode = 'supabase';
    mockState.consentAt = '2026-10-01T10:00:00.000Z';
    await render(<TalkScreen />);
    await sendTyped('Hola');
    await waitFor(() => expect(mockCoach).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('¿Compartimos tus datos con Cloudflare?')).toBeNull();
  });
});
