import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import TalkScreen from '@/app/talk';
import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type {
  ApplyResult,
  CoachRequest,
  CoachResponse,
  Friend,
  PlanProposal,
  Profile,
  ProposalStatus,
  Thresholds,
  WeekPlanDraft,
} from '@/domain/types';
import { makeCoachResponse, makeLifeEvent, makeProposal, makeWorkout } from '@/features/coach/__tests__/fixtures';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: {
  mode: 'demo' | 'supabase';
  params: Record<string, string>;
  consentAt: string | null;
  thresholds: Thresholds | null;
  saveError: Error | null;
} = {
  mode: 'demo',
  params: {},
  consentAt: null,
  thresholds: null,
  saveError: null,
};
const mockCoach = jest.fn(async (_request: CoachRequest): Promise<CoachResponse> => makeCoachResponse());
const mockApply = jest.fn(async (_vars: { changes: unknown[]; proposalId?: string }): Promise<ApplyResult> => ({ applied: 2, failed: [], workouts: [] }));
const mockSetStatus = jest.fn(async (_vars: { id: string; status: ProposalStatus }) => undefined);
const mockSaveWeekPlans = jest.fn(async (drafts: WeekPlanDraft[]) => {
  if (mockState.saveError) throw mockState.saveError;
  return drafts;
});
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => patch);
const mockSpeak = jest.fn();
const mockFriends: Friend[] = [
  {
    friendshipId: 'fs1',
    profile: { id: 'david-id', username: 'davidm', displayName: 'David Molina', avatarUrl: null, sports: [] },
    status: 'accepted',
    direction: 'mutual',
    visibility: 'full',
    createdAt: '2026-10-01T10:00:00.000Z',
  },
];
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
  useFriends: () => ({ data: mockFriends }),
  useProposal: () => ({ data: undefined }),
  useProfile: () => ({ data: { aiConsentAt: mockState.consentAt, thresholds: mockState.thresholds }, isLoading: false }),
  useRaces: () => ({ data: [] }),
  useSaveWeekPlans: () => ({ mutateAsync: mockSaveWeekPlans, isPending: false }),
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
    stop: jest.fn(async () => undefined),
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
  mockState.thresholds = null;
  mockState.saveError = null;
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

describe('Talk — quedada suggested by the coach', () => {
  beforeEach(() => {
    mockVoice.available = false;
    mockCoach.mockImplementation(async () =>
      makeCoachResponse({
        reply: 'Te propongo un rodaje con David el sábado por la mañana.',
        quedada: {
          friendId: 'david-id',
          friendName: 'David Molina',
          sport: 'run',
          date: '2026-11-07',
          startTime: '08:00',
          durationMin: 60,
          intensity: 'endurance',
          title: 'Rodaje juntos',
          location: 'Retiro',
          reason: 'Los dos tenéis libre el sábado temprano.',
        },
      }),
    );
  });

  test('a message naming a friend sends friendIds and the card opens the prefilled form (nothing is sent)', async () => {
    await render(<TalkScreen />);
    await sendTyped('Quiero rodar con David este finde');
    expect(await screen.findByText('Quedada con David')).toBeTruthy();
    expect(mockCoach.mock.calls[0]?.[0]).toMatchObject({ friendIds: ['david-id'] });
    expect(screen.getByText('Sáb 7 nov · 08:00 · Rodaje juntos · 1h · Retiro')).toBeTruthy();
    expect(screen.getByText('Los dos tenéis libre el sábado temprano.')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Preparar la invitación' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/joint/new',
      params: {
        friendId: 'david-id',
        date: '2026-11-07',
        sport: 'run',
        startTime: '08:00',
        durationMin: '60',
        intensity: 'endurance',
        title: 'Rodaje juntos',
        location: 'Retiro',
      },
    });
  });

  test('messages without friends do not send friendIds and show no card', async () => {
    mockCoach.mockImplementation(async () => makeCoachResponse({ reply: 'Descansa hoy.' }));
    await render(<TalkScreen />);
    await sendTyped('Me duele la rodilla');
    await screen.findByText('Descansa hoy.');
    expect(mockCoach.mock.calls[0]?.[0]).not.toHaveProperty('friendIds');
    expect(screen.queryByRole('button', { name: 'Preparar la invitación' })).toBeNull();
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

describe('Talk — a new session in the proposal', () => {
  const SERIES = makeProposal({
    id: 'p10',
    source: 'ai_coach',
    changes: [
      {
        op: 'add',
        workout: {
          date: '2026-10-29',
          sport: 'run',
          title: "Series 3×8'",
          durationMin: 55,
          intensity: 'threshold',
          steps: [
            { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
            { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Mismo ritmo en las tres.' },
            { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
          ],
          coaching: { objective: 'Subir tu umbral sin pasarte.', keys: [], success: 'Las tres series en zona.', planB: null },
        },
        reason: 'La sesión clave de la semana',
      },
    ],
  });

  beforeEach(() => {
    mockVoice.available = false;
    mockCoach.mockImplementation(async () => makeCoachResponse({ reply: 'Te añado unas series el jueves.', proposal: SERIES }));
  });

  test("shows what the session asks with the athlete's targets and its steps on demand", async () => {
    mockState.thresholds = { lthr: 170 };
    await render(<TalkScreen />);
    await sendTyped('Quiero series esta semana');
    expect(await screen.findByText('Subir tu umbral sin pasarte.')).toBeTruthy();
    expect(screen.getByText("3×8' Z4 · 162–168 ppm · RPE 7–8")).toBeTruthy();
    expect(screen.queryByText('Mismo ritmo en las tres.')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Ver la estructura, 3 pasos' }));
    expect(screen.getByText('Mismo ritmo en las tres.')).toBeTruthy();
    expect(screen.getByText('162–168 ppm · RPE 7–8')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ocultar la estructura' })).toBeTruthy();
  });

  test('without thresholds the zone and RPE still show', async () => {
    await render(<TalkScreen />);
    await sendTyped('Quiero series esta semana');
    expect(await screen.findByText("3×8' Z4 · RPE 7–8")).toBeTruthy();
  });
});

describe('Talk — plan general suggested by the coach', () => {
  const monday = startOfWeek(todayISO());
  const weekPlans: WeekPlanDraft[] = [
    { weekStart: addDays(monday, 14), kind: 'push', targetMinutes: 540, note: null },
    { weekStart: addDays(monday, 7), kind: 'recovery', targetMinutes: 300, note: 'Semana suave antes de subir.' },
  ];

  beforeEach(() => {
    mockVoice.available = false;
    mockCoach.mockImplementation(async () => makeCoachResponse({ reply: 'Así veo tus próximas semanas.', weekPlans }));
  });

  test('lists one row per week in date order and saves them on tap, then opens Plan › General', async () => {
    await render(<TalkScreen />);
    await sendTyped('¿Cómo planteo el próximo mes?');
    expect(await screen.findByText('Plan general · 2 semanas')).toBeTruthy();
    expect(screen.getByText(/· Descarga · 5 h$/)).toBeTruthy();
    expect(screen.getByText(/· Más volumen · 9 h$/)).toBeTruthy();
    expect(screen.getByText('Semana suave antes de subir.')).toBeTruthy();
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Guardar en tu plan general' }));
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith('/week?view=general'));
    expect(mockSaveWeekPlans).toHaveBeenCalledWith([
      { weekStart: addDays(monday, 7), kind: 'recovery', targetMinutes: 300, note: 'Semana suave antes de subir.', source: 'ai_coach' },
      { weekStart: addDays(monday, 14), kind: 'push', targetMinutes: 540, note: null, source: 'ai_coach' },
    ]);
    expect(await screen.findByText('Guardado en tu plan general.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar en tu plan general' })).toBeNull();
  });

  test('weeks from the rules engine are saved as your own', async () => {
    mockCoach.mockImplementation(async () => makeCoachResponse({ reply: 'Plan de semanas.', engine: 'rules', weekPlans }));
    await render(<TalkScreen />);
    await sendTyped('Plan de semanas');
    await fireEvent.press(await screen.findByRole('button', { name: 'Guardar en tu plan general' }));
    await waitFor(() => expect(mockSaveWeekPlans).toHaveBeenCalledTimes(1));
    expect(mockSaveWeekPlans.mock.calls[0]?.[0].map((d) => d.source)).toEqual(['manual', 'manual']);
  });

  test('"Ahora no" leaves the general plan as it was', async () => {
    await render(<TalkScreen />);
    await sendTyped('¿Cómo planteo el próximo mes?');
    await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(await screen.findByText('Vale, dejo tu plan general como estaba.')).toBeTruthy();
    expect(screen.queryByText('Plan general · 2 semanas')).toBeNull();
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  test('a failed save keeps the card with the error', async () => {
    mockState.saveError = new Error('Sin conexión');
    await render(<TalkScreen />);
    await sendTyped('¿Cómo planteo el próximo mes?');
    await fireEvent.press(await screen.findByRole('button', { name: 'Guardar en tu plan general' }));
    expect(await screen.findByText('Sin conexión')).toBeTruthy();
    expect(screen.getByText('Plan general · 2 semanas')).toBeTruthy();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  test('answers without week plans show no card', async () => {
    mockCoach.mockImplementation(async () => makeCoachResponse({ reply: 'Descansa hoy.', weekPlans: [] }));
    await render(<TalkScreen />);
    await sendTyped('Me duele la rodilla');
    await screen.findByText('Descansa hoy.');
    expect(screen.queryByRole('button', { name: 'Guardar en tu plan general' })).toBeNull();
  });
});
