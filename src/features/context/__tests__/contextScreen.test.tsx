import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AthleteContextScreen from '@/app/settings/context';
import { EMPTY_ATHLETE_CONTEXT } from '@/domain/athleteContext';
import type { AthleteContext, CoachRequest, CoachResponse, LifeEventDraft, Profile } from '@/domain/types';
import { ContextPromptCard, shouldShowContextPrompt } from '@/features/context/ContextPromptCard';
import {
  addNote,
  applyAnswer,
  contextSubtitle,
  finish,
  nextQuestion,
  periodEventDraft,
  progress,
  questionsFor,
  skip,
  summarySections,
  watchSleepTimes,
} from '@/features/context/interviewModel';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

const mockProfile: Profile = {
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

const mockState: { profile: Profile; ai: boolean } = { profile: mockProfile, ai: false };
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => {
  mockState.profile = { ...mockState.profile, ...patch };
  return mockState.profile;
});
const mockCreateEvent = jest.fn(async (draft: LifeEventDraft) => ({ id: `ev-${draft.startDate}`, ...draft }));
const mockDeleteEvent = jest.fn(async (_id: string) => undefined);
const mockCoach = jest.fn(
  async (_r: CoachRequest): Promise<CoachResponse> => ({
    reply: 'Gracias, lo tendré en cuenta.',
    proposal: null,
    engine: 'ai',
    memory: ['Tiene dos hijos pequeños'],
    lifeEvent: null,
    quedada: null,
  }),
);

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('expo-router/react-navigation', () => ({ HeaderHeightContext: jest.requireActual<typeof import('react')>('react').createContext(0) }));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@react-native-community/datetimepicker', () => {
  const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: (props: { onValueChange: (e: unknown, d: Date) => void }) =>
      createElement(TextInput, { testID: 'date-picker', onChangeText: (t: string) => props.onValueChange({}, new Date(`${t}T12:00:00`)) }),
  };
});
jest.mock('@/features/coach/aiCoachFlag', () => ({ isAiCoachEnabled: () => mockState.ai }));
jest.mock('@/data/queries', () => ({
  useProfile: () => ({ data: mockState.profile, isLoading: false, isError: false, refetch: jest.fn() }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
  useCreateLifeEvent: () => ({ mutateAsync: mockCreateEvent, isPending: false }),
  useDeleteLifeEvent: () => ({ mutateAsync: mockDeleteEvent, isPending: false }),
  useMetrics: () => ({ data: [] }),
  useCoach: () => ({ mutateAsync: mockCoach, isPending: false }),
}));

const SPORTS = ['swim', 'bike', 'run'] as const;

function savedContext(): AthleteContext {
  const calls = mockUpdateProfile.mock.calls;
  return calls[calls.length - 1]?.[0].athleteContext as AthleteContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.profile = mockProfile;
  mockState.ai = false;
});

describe('interviewModel', () => {
  test('the questions follow the athlete: sports, studies, work and weekends', () => {
    const base = EMPTY_ATHLETE_CONTEXT;
    const ids = (ctx: AthleteContext, sports: readonly ('swim' | 'bike' | 'run' | 'strength')[] = SPORTS) => questionsFor(ctx, sports).map((q) => q.id);
    expect(ids(base, ['run'])).not.toContain('swim_bg');
    expect(ids(base)).not.toContain('load');
    const student = applyAnswer(base, 'occupation', { choice: 'study' });
    expect(ids(student)).toEqual(expect.arrayContaining(['load', 'schedule', 'exams', 'busy']));
    const worker = applyAnswer(base, 'occupation', { choice: 'work' });
    expect(ids(worker)).not.toContain('exams');
    expect(ids(applyAnswer(base, 'weekend', { choice: 'later' }))).toContain('weekend_sleep');
    expect(ids(applyAnswer(base, 'weekend', { choice: 'same' }))).not.toContain('weekend_sleep');
  });

  test('resumable: answered and skipped ids decide the next question; finish closes it', () => {
    let ctx = applyAnswer(EMPTY_ATHLETE_CONTEXT, 'swim_bg', { choice: 'lifelong' });
    ctx = applyAnswer(ctx, 'swim_goal', { choice: 'maintain' });
    ctx = skip(ctx, 'bike_bg');
    expect(nextQuestion(ctx, SPORTS)?.id).toBe('bike_goal');
    expect(ctx.sports.swim).toEqual({ background: 'lifelong', goal: 'maintain' });
    expect(progress(ctx, SPORTS)).toEqual({ done: 3, total: questionsFor(ctx, SPORTS).length });
    expect(contextSubtitle(ctx, SPORTS)).toMatch(/^A medias: 3 de/);
    const done = finish(addNote(ctx, 'Trabajo a turnos en el hospital'));
    expect(done.completedAt).not.toBeNull();
    expect(done.notes).toEqual(['Trabajo a turnos en el hospital']);
    expect(contextSubtitle(null, SPORTS)).toBe('Cuéntale al coach cómo eres: 3 min');
  });

  test('answers in words, periods as life events, sleep from the watch', () => {
    let ctx = applyAnswer(EMPTY_ATHLETE_CONTEXT, 'limitations', { choice: 'none', text: '' });
    ctx = applyAnswer(ctx, 'races', { choice: 'some', text: 'un sprint' });
    ctx = applyAnswer(ctx, 'meals', { times: { lunch: '14:00', dinner: '21:30' } });
    expect(ctx.limitations).toBeNull();
    expect(ctx.previousRaces).toBe('Alguna: un sprint');
    const sport = summarySections(ctx, SPORTS).find((s) => s.section === 'sport');
    expect(sport?.rows.find((r) => r.id === 'limitations')?.value).toBe('Ninguna');
    const habits = summarySections(ctx, SPORTS).find((s) => s.section === 'habits');
    expect(habits?.rows.find((r) => r.id === 'meals')?.value).toBe('comida 14:00, cena 21:30');
    expect(periodEventDraft({ kind: 'exams', from: '2027-01-12', to: '2027-01-30', label: 'Exámenes', eventId: null })).toMatchObject({
      kind: 'exam',
      startDate: '2027-01-12',
      endDate: '2027-01-30',
      severity: 2,
    });
    const night = (d: string, start: string, end: string) => ({ sleepStart: new Date(`${d}T${start}`).toISOString(), sleepEnd: new Date(`${addOne(d)}T${end}`).toISOString() });
    const nights = [night('2026-11-16', '23:10', '06:40'), night('2026-11-17', '23:20', '06:35'), night('2026-11-18', '23:00', '06:50')];
    expect(watchSleepTimes(nights)).toEqual({ wake: '06:45', bed: '23:15', weekendWake: null, weekendBed: null });
  });
});

function addOne(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('Tu contexto screen', () => {
  test('asks one question at a time and saves every answer', async () => {
    await render(<AthleteContextScreen />);
    expect(screen.getByText('¿Cuánto llevas nadando?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Desde pequeño'));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(savedContext().sports.swim).toEqual({ background: 'lifelong' });
    expect(screen.getByText('En natación, ¿qué buscas para tu carrera?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Mantener'));
    await waitFor(() => expect(savedContext().sports.swim).toEqual({ background: 'lifelong', goal: 'maintain' }));
    await fireEvent.press(screen.getByText('Saltar'));
    await waitFor(() => expect(savedContext().answered).toEqual(['swim_bg', 'swim_goal', 'bike_bg']));
    expect(screen.getByText('En bici, ¿qué buscas?')).toBeTruthy();
  });

  test('exam periods become exam life events', async () => {
    const answered = ['swim_bg', 'swim_goal', 'bike_bg', 'bike_goal', 'run_bg', 'run_goal', 'limitations', 'races', 'occupation', 'load', 'schedule'];
    mockState.profile = { ...mockProfile, athleteContext: { ...EMPTY_ATHLETE_CONTEXT, occupation: 'study', answered } };
    await render(<AthleteContextScreen />);
    expect(screen.getByText('¿Cuándo tienes exámenes?')).toBeTruthy();
    expect(screen.getByText(/Seguimos donde lo dejaste/)).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Elegir fecha')[0]!);
    await fireEvent.press(screen.getAllByText('Elegir fecha')[0]!);
    await fireEvent.changeText(screen.getAllByTestId('date-picker')[0]!, '2027-01-12');
    await fireEvent.changeText(screen.getAllByTestId('date-picker')[1]!, '2027-01-30');
    await fireEvent.press(screen.getByText('Añadir'));
    await fireEvent.press(screen.getByText('Seguir'));
    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exam', startDate: '2027-01-12', endDate: '2027-01-30' })));
    await waitFor(() => expect(savedContext().periods).toEqual([{ kind: 'exams', from: '2027-01-12', to: '2027-01-30', label: 'Exámenes', eventId: 'ev-2027-01-12' }]));
  });

  test('«¿Algo más?» without the AI keeps the text as a note; finishing shows the summary', async () => {
    const all = questionsFor(EMPTY_ATHLETE_CONTEXT, SPORTS).map((q) => q.id).filter((id) => id !== 'free');
    mockState.profile = { ...mockProfile, athleteContext: { ...EMPTY_ATHLETE_CONTEXT, answered: all } };
    await render(<AthleteContextScreen />);
    expect(screen.getByTestId('context-chat')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Tu mensaje para el coach'), 'Trabajo a turnos y algunas semanas no libro');
    await fireEvent.press(screen.getByText('Enviar'));
    await waitFor(() => expect(savedContext().notes).toEqual(['Trabajo a turnos y algunas semanas no libro']));
    expect(mockCoach).not.toHaveBeenCalled();
    expect(screen.getByText('Apuntado. Lo tendré en cuenta al planificar tus semanas.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Terminar'));
    await waitFor(() => expect(savedContext().completedAt).not.toBeNull());
    expect(screen.getByTestId('context-summary')).toBeTruthy();
  });

  test('with the AI the coach answers in «context» mode and its facts are shown', async () => {
    mockState.ai = true;
    const all = questionsFor(EMPTY_ATHLETE_CONTEXT, SPORTS).map((q) => q.id).filter((id) => id !== 'free');
    mockState.profile = { ...mockProfile, aiConsentAt: '2026-10-01T10:00:00.000Z', athleteContext: { ...EMPTY_ATHLETE_CONTEXT, answered: all } };
    await render(<AthleteContextScreen />);
    await fireEvent.changeText(screen.getByLabelText('Tu mensaje para el coach'), 'Tengo dos hijos pequeños');
    await fireEvent.press(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText('Apuntado: Tiene dos hijos pequeños')).toBeTruthy());
    expect(mockCoach).toHaveBeenCalledWith(expect.objectContaining({ mode: 'chat', topic: 'context', message: 'Tengo dos hijos pequeños' }));
    // The AI kept the fact in its notes: no duplicate note in the context.
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  test('a finished context opens on the summary, each row editable', async () => {
    const ctx = finish(applyAnswer(applyAnswer(EMPTY_ATHLETE_CONTEXT, 'occupation', { choice: 'work' }), 'load', { choice: 'high' }));
    mockState.profile = { ...mockProfile, athleteContext: ctx };
    await render(<AthleteContextScreen />);
    expect(screen.getByTestId('context-summary')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Carga. Alta'));
    expect(screen.getByText('¿Cuánta carga te supone normalmente?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Media'));
    await waitFor(() => expect(savedContext().load).toBe('medium'));
    expect(screen.getByLabelText('Carga. Media')).toBeTruthy();
    // Changing the occupation asks what it opens (studies → exams) before going back.
    await fireEvent.press(screen.getByLabelText('Estudias o trabajas. Trabajo'));
    await fireEvent.press(screen.getByLabelText('Las dos cosas'));
    await waitFor(() => expect(savedContext().occupation).toBe('both'));
    expect(screen.getByText('¿Cómo es tu horario típico?')).toBeTruthy();
  });
});

describe('Hoy prompt', () => {
  test('shown until finished or closed', async () => {
    expect(shouldShowContextPrompt(null)).toBe(true);
    expect(shouldShowContextPrompt({ ...EMPTY_ATHLETE_CONTEXT, promptDismissed: true })).toBe(false);
    expect(shouldShowContextPrompt(finish(EMPTY_ATHLETE_CONTEXT))).toBe(false);
    await render(<ContextPromptCard />);
    await fireEvent.press(screen.getByLabelText(/Cuéntale al coach cómo eres/));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/context');
    await fireEvent.press(screen.getByLabelText('Ahora no'));
    await waitFor(() => expect(savedContext().promptDismissed).toBe(true));
  });
});
