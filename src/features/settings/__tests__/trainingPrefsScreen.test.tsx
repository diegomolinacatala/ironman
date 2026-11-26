import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TrainingPrefsScreen from '@/app/settings/training';
import type { Profile, TrainingPrefs } from '@/domain/types';
import {
  addFixed,
  EMPTY_FIXED,
  editablePrefs,
  fixedDraftError,
  prefsToSave,
  setCount,
  togglePreferredDay,
  trainingPrefsSubtitle,
} from '@/features/settings/trainingPrefsModel';

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

const mockState: { profile: Profile } = { profile: mockProfile };
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => ({ ...mockState.profile, ...patch }));

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
jest.mock('@/data/queries', () => ({
  useProfile: () => ({ data: mockState.profile, isLoading: false, isError: false, refetch: jest.fn() }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
}));

const CLUB = { sport: 'swim' as const, weekday: 1 as const, startTime: '20:00', durationMin: 60, title: 'Natación del club' };

beforeEach(() => {
  jest.clearAllMocks();
  mockState.profile = mockProfile;
});

describe('trainingPrefsModel', () => {
  test('editing helpers; everything automático saves null', () => {
    let p = editablePrefs(null);
    expect(prefsToSave(p)).toBeNull();
    expect(trainingPrefsSubtitle(null)).toBe('Automático · el plan decide el reparto');
    p = setCount(p, 'run', 3);
    p = togglePreferredDay(p, 'swim', 2);
    p = togglePreferredDay(p, 'swim', 0);
    expect(p.sessionsPerWeek).toEqual({ run: 3 });
    expect(p.preferredDays).toEqual({ swim: [0, 2] });
    expect(trainingPrefsSubtitle(p)).toBe('Piscina L y X, 3 de carrera');
    p = setCount(togglePreferredDay(togglePreferredDay(p, 'swim', 0), 'swim', 2), 'run', -1);
    expect(prefsToSave(p)).toBeNull();
  });

  test('fixed sessions: time and duration are checked, the title defaults to the sport', () => {
    expect(fixedDraftError({ ...EMPTY_FIXED, startTime: '25:00' }, 0)).toMatch(/Hora inválida/);
    expect(fixedDraftError({ ...EMPTY_FIXED, durationMin: 5 }, 0)).toMatch(/duración/);
    expect(fixedDraftError(EMPTY_FIXED, 10)).toMatch(/Como mucho 10/);
    expect(fixedDraftError(EMPTY_FIXED, 0)).toBeNull();
    const p = addFixed(editablePrefs(null), { ...EMPTY_FIXED, sport: 'run', weekday: 3, startTime: ' ' });
    expect(p.fixedSessions).toEqual([{ sport: 'run', weekday: 3, startTime: null, durationMin: 60, title: 'Carrera' }]);
  });
});

describe('Tu forma de entrenar (screen)', () => {
  test('starts in automático; days, sessions, intensity and a fixed session are saved', async () => {
    await render(<TrainingPrefsScreen />);
    expect(screen.getByText('Todo automático')).toBeTruthy();
    // Order of the day pickers: long ride, long run, then swim, bike, run.
    await fireEvent.press(screen.getAllByRole('checkbox', { name: 'Sábado' })[0]!);
    await fireEvent.press(screen.getAllByRole('checkbox', { name: 'Domingo' })[1]!);
    await fireEvent.press(screen.getAllByRole('checkbox', { name: 'Lunes' })[2]!);
    await fireEvent.press(screen.getAllByRole('checkbox', { name: 'Miércoles' })[2]!);
    // Carrera: Automático → Ninguna → 1 → 2 → 3.
    for (let i = 0; i < 4; i += 1) await fireEvent.press(screen.getByRole('button', { name: 'Sumar: Carrera' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Polarizado 80/20' }));
    expect(screen.getByTestId('training-prefs-summary')).toHaveTextContent('piscina L y X, larga S, tirada larga D, 3 de carrera, polarizado 80/20');

    // Club swim on Tuesday at 20:00.
    await fireEvent.press(screen.getByRole('button', { name: 'Natación' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Martes' }));
    await fireEvent.changeText(screen.getByLabelText('Hora (opcional)'), '20:00');
    await fireEvent.changeText(screen.getByLabelText('Nombre (opcional)'), 'Natación del club');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir sesión fija' }));
    expect(screen.getByText('Natación del club')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const expected: TrainingPrefs = {
      sessionsPerWeek: { run: 3 },
      preferredDays: { swim: [0, 2] },
      longRideDays: [5],
      longRunDays: [6],
      intensityModel: 'polarized',
      fixedSessions: [CLUB],
    };
    expect(mockUpdateProfile.mock.calls[0]?.[0]).toEqual({ trainingPrefs: expected });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test('a wrong time is shown and nothing is added', async () => {
    await render(<TrainingPrefsScreen />);
    await fireEvent.changeText(screen.getByLabelText('Hora (opcional)'), '8pm');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir sesión fija' }));
    expect(screen.getByText(/Hora inválida/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Quitar / })).toBeNull();
  });

  test('saved choices load; «Volver a automático» saves null', async () => {
    mockState.profile = {
      ...mockProfile,
      trainingPrefs: { sessionsPerWeek: {}, preferredDays: {}, longRideDays: [], longRunDays: [], intensityModel: 'pyramidal', fixedSessions: [CLUB] },
    };
    await render(<TrainingPrefsScreen />);
    expect(screen.getByTestId('training-prefs-summary')).toHaveTextContent('piramidal, natación del club M 20:00');
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar Natación del club' }));
    expect(screen.queryByText('Natación del club')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a automático' }));
    expect(screen.getByText('Todo automático')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ trainingPrefs: null }));
  });
});
