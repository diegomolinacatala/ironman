import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PlacesScreen from '@/app/settings/places';
import type { Profile } from '@/domain/types';
import { placesForm, placesFormError, placesPatch } from '@/features/places/placesModel';
import { friendSlotsFor, withSocial } from '@/features/week/socialPlan';

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

beforeEach(() => {
  jest.clearAllMocks();
  mockState.profile = mockProfile;
});

describe('placesModel', () => {
  test('empty form clears places and leaves the questions alone; checks names', () => {
    const empty = placesForm(mockProfile);
    expect(placesPatch(empty, null)).toEqual({ places: null });
    expect(placesFormError({ ...empty, awayName: 'Castellón' })).toMatch(/ciudad principal/);
    expect(placesFormError({ ...empty, homeName: 'Valencia', awayName: 'valencia' })).toMatch(/mismo nombre/);
    expect(placesPatch({ ...empty, questions: false }, { enabled: true, weeks: [{ weekStart: '2026-11-30', load: 'busy' }] })).toEqual({
      places: null,
      weekQuestions: { enabled: false, weeks: [{ weekStart: '2026-11-30', load: 'busy' }] },
    });
  });
});

describe('Mis sitios (screen)', () => {
  test('both cities with their gear and the questions switch are saved', async () => {
    await render(<PlacesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ciudad'), 'Valencia');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Rodillo' })[0]!);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Piscina' })[0]!);
    await fireEvent.changeText(screen.getByLabelText('Ciudad (opcional)'), 'Castellón');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Bici de carretera' })[1]!);
    await fireEvent(screen.getByRole('switch', { name: 'Domingo y miércoles' }), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile.mock.calls[0]?.[0]).toEqual({
      places: {
        home: { name: 'Valencia', gear: { roadBike: false, trainer: true, pool: true, gym: false } },
        away: { name: 'Castellón', gear: { roadBike: true, trainer: false, pool: false, gym: false } },
      },
      weekQuestions: { enabled: true, weeks: [] },
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test('a second city without the main one is not saved', async () => {
    await render(<PlacesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ciudad (opcional)'), 'Castellón');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Pon primero tu ciudad principal.')).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
});

describe('socialPlan (Planificar semana · con gente)', () => {
  const weekStart = '2026-11-30';
  const profile: Profile = { ...mockProfile, weekQuestions: { enabled: true, weeks: [{ weekStart, priority: 'together' }] } };
  const data = { busyBlocks: [], workouts: [], profile, today: '2026-11-29' };
  const friend = {
    friendId: 'f1',
    displayName: 'Ana García',
    items: [{ kind: 'busy' as const, id: null, date: '2026-12-02', startTime: '06:30', endTime: '17:00', durationMin: null, sport: null, intensity: null, title: null, status: null, jointSessionId: null }],
  };

  test('common slots per friend and the new ride takes one', () => {
    const slots = friendSlotsFor(data, weekStart, [friend]);
    expect(slots[0]?.name).toBe('Ana');
    expect(slots[0]?.slots.find((s) => s.date === '2026-12-02')?.start).toBe('17:15');
    const planned = {
      summary: 'Te propongo la semana.',
      changes: [
        {
          op: 'add' as const,
          reason: 'Base.',
          workout: { date: '2026-12-02', startTime: null, sport: 'bike' as const, title: 'Bici', description: null, durationMin: 90, distanceM: null, intensity: 'endurance' as const, tss: 60, steps: [], isKey: false, source: 'rules' as const },
        },
      ],
    };
    const out = withSocial(planned, weekStart, data, [friend]);
    expect(out.changes[0]?.op === 'add' && out.changes[0].workout.startTime).toBe('17:15');
    expect(out.summary).toMatch(/Con gente: 1 sesión cae en huecos libres de Ana/);
    expect(withSocial(planned, weekStart, { ...data, profile: mockProfile }, [friend])).toBe(planned);
  });
});
