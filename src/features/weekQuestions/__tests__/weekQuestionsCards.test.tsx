import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { Friend, PlanChange, Profile, ProfilePatch, Workout } from '@/domain/types';
import { TodayQuestions } from '@/features/weekQuestions/TodayQuestions';
import { resetRideAskedCache } from '@/features/weekQuestions/rideAskStore';

const SUNDAY = '2026-11-29';
const NEXT_MONDAY = '2026-11-30';
const WEDNESDAY = '2026-12-02';
const SATURDAY = '2026-12-05';

const PLACES: NonNullable<Profile['places']> = {
  home: { name: 'Valencia', gear: { roadBike: false, trainer: true, pool: true, gym: true } },
  away: { name: 'Castellón', gear: { roadBike: true, trainer: false, pool: false, gym: false } },
};

const BASE: Profile = {
  id: 'me',
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

function friend(id: string, name: string): Friend {
  return {
    friendshipId: `fs-${id}`,
    profile: { id, username: id, displayName: name, avatarUrl: null, sports: ['bike'] },
    status: 'accepted',
    direction: 'mutual',
    visibility: 'full',
    createdAt: '2026-10-01T10:00:00.000Z',
  };
}

function workout(overrides: Partial<Workout>): Workout {
  return {
    id: 'w1',
    userId: 'me',
    date: SUNDAY,
    startTime: null,
    sport: 'bike',
    title: 'Bici fondo',
    description: null,
    durationMin: 90,
    distanceM: null,
    intensity: 'endurance',
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'rules',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const mockState: { profile: Profile; friends: Friend[]; workouts: Workout[] } = { profile: BASE, friends: [], workouts: [] };
const mockUpdateProfile = jest.fn(async (patch: ProfilePatch) => {
  mockState.profile = { ...mockState.profile, ...patch } as Profile;
  return mockState.profile;
});
const mockCreateProposal = jest.fn(async (draft: { changes: PlanChange[] }) => ({ id: 'p1', ...draft }));
const mockOpenJointNew = jest.fn();
const mockPlan = jest.fn(async (_weekStart: string, _data: unknown) => undefined);

jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/features/together/navigation', () => ({ openJointNew: (p: unknown) => mockOpenJointNew(p) }));
jest.mock('@/features/week/useWeekData', () => ({ useWeekData: () => ({ isLoading: false }) }));
jest.mock('@/features/week/usePlanWeek', () => ({ usePlanWeek: () => ({ plan: mockPlan, busy: false }) }));
jest.mock('@/data/queries', () => {
  const ok = <T,>(data: T) => ({ data, isLoading: false, error: null });
  return {
    useProfile: () => ok(mockState.profile),
    useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
    useFriends: () => ok(mockState.friends),
    useWorkouts: () => ok(mockState.workouts),
    useBusyBlocks: () => ok([]),
    useJointSessions: () => ok([]),
    useLifeEvents: () => ok([]),
    useRaces: () => ok([]),
    useCreateProposal: () => ({ mutateAsync: mockCreateProposal, isPending: false }),
  };
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetRideAskedCache();
  mockState.profile = { ...BASE, places: PLACES, weekQuestions: { enabled: true, weeks: [] } };
  mockState.friends = [friend('f1', 'Ana García'), friend('f2', 'Luis Pérez')];
  mockState.workouts = [];
});

describe('Hoy · Tu semana (Sunday)', () => {
  test('two taps save priority and load for the coming week; the follow-up offers to plan it', async () => {
    const { rerender } = await render(<TodayQuestions today={SUNDAY} />);
    expect(screen.getByText('Tu semana')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Entrenar con gente' }));
    await fireEvent.changeText(screen.getByLabelText('¿Qué planes tienes?'), 'Cena el viernes');
    await fireEvent.press(screen.getByRole('button', { name: 'Muchas cosas' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile.mock.calls[0]?.[0]).toEqual({
      weekQuestions: { enabled: true, weeks: [{ weekStart: NEXT_MONDAY, priority: 'together', load: 'busy', sundayDone: true, plans: 'Cena el viernes' }] },
    });
    await rerender(<TodayQuestions today={SUNDAY} />);
    expect(await screen.findByText('Apuntado')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Planificar semana' }));
    await waitFor(() => expect(mockPlan).toHaveBeenCalledWith(NEXT_MONDAY, expect.anything()));
  });

  test('off by default: nothing is asked', async () => {
    mockState.profile = BASE;
    await render(<TodayQuestions today={SUNDAY} />);
    expect(screen.queryByText('Tu semana')).toBeNull();
  });
});

describe('Hoy · Tu fin de semana (Wednesday)', () => {
  test('«Sí» → the weekend follows Castellón (proposal) → bike outside → with whom prefills a quedada', async () => {
    mockState.workouts = [workout({ id: 'sat-ride', date: SATURDAY, title: 'Rodillo · Bici larga', durationMin: 150 })];
    const view = await render(<TodayQuestions today={WEDNESDAY} />);
    expect(screen.getByText('¿Este fin de semana vuelves a Castellón?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, a Castellón' }));
    await waitFor(() => expect(mockCreateProposal).toHaveBeenCalledTimes(1));
    const proposal = mockCreateProposal.mock.calls[0]?.[0] as { changes: PlanChange[] };
    expect(proposal.changes[0]).toMatchObject({ op: 'update', workoutId: 'sat-ride', patch: { title: 'Bici larga' } });

    await view.rerender(<TodayQuestions today={WEDNESDAY} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, salgo' }));
    await view.rerender(<TodayQuestions today={WEDNESDAY} />);
    expect(await screen.findByText('¿Con quién?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ana' }));
    expect(mockOpenJointNew).toHaveBeenCalledWith(expect.objectContaining({ friendId: 'f1', fromWorkoutId: 'sat-ride', sport: 'bike', date: SATURDAY }));
    await waitFor(() => expect(mockState.profile.weekQuestions?.weeks[0]).toMatchObject({ awayWeekend: true, awayRide: true, wednesdayDone: true }));
  });

  test('«No, me quedo» closes it for the week', async () => {
    await render(<TodayQuestions today={WEDNESDAY} />);
    await fireEvent.press(screen.getByRole('button', { name: 'No, me quedo' }));
    await waitFor(() => expect(mockState.profile.weekQuestions?.weeks[0]).toEqual({ weekStart: NEXT_MONDAY, awayWeekend: false, wednesdayDone: true }));
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });
});

describe('Hoy · ¿Sales con alguien? (every athlete)', () => {
  test('asks once for the next outdoor ride; a friend prefills the quedada, then it is gone', async () => {
    mockState.profile = BASE;
    mockState.workouts = [
      workout({ id: 'trainer', date: '2026-12-01', title: 'Rodillo · Umbral' }),
      workout({ id: 'ride', date: '2026-12-01', title: 'Bici tempo', startTime: '18:00' }),
    ];
    const view = await render(<TodayQuestions today="2026-12-01" />);
    expect(await screen.findByText('¿Sales con alguien?')).toBeTruthy();
    expect(screen.getByText(/Bici tempo · Hoy/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Luis' }));
    expect(mockOpenJointNew).toHaveBeenCalledWith(expect.objectContaining({ friendId: 'f2', fromWorkoutId: 'ride', startTime: '18:00' }));
    await view.rerender(<TodayQuestions today="2026-12-01" />);
    await waitFor(() => expect(screen.queryByText('¿Sales con alguien?')).toBeNull());
  });

  test('«Solo» dismisses it; no friends = no question', async () => {
    mockState.profile = BASE;
    mockState.workouts = [workout({ id: 'ride', date: '2026-12-01' })];
    const view = await render(<TodayQuestions today="2026-12-01" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Solo' }));
    await waitFor(() => expect(screen.queryByText('¿Sales con alguien?')).toBeNull());
    mockState.friends = [];
    resetRideAskedCache();
    view.unmount();
    await render(<TodayQuestions today="2026-12-01" />);
    expect(screen.queryByText('¿Sales con alguien?')).toBeNull();
  });
});
