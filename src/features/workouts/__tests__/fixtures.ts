import type { BusyBlock, JointSession, LifeEvent, Profile, Race, TrainingWindow, Weekday, Workout } from '@/domain/types';

export const ME = 'user-me';
export const ALEX = 'user-alex';

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: overrides.id ?? 'w1',
    userId: ME,
    date: '2026-10-25',
    startTime: null,
    sport: 'run',
    title: 'Rodaje',
    description: null,
    durationMin: 45,
    distanceM: null,
    intensity: 'endurance',
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'manual',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

export function makeSession(overrides: Partial<JointSession> = {}): JointSession {
  return {
    id: 's1',
    organizerId: ALEX,
    sport: 'run',
    date: '2026-10-26',
    startTime: '09:00',
    durationMin: 90,
    intensity: 'endurance',
    title: 'Tirada larga',
    location: null,
    notes: null,
    status: 'proposed',
    participants: [
      { userId: ALEX, displayName: 'Álex García', avatarUrl: null, status: 'accepted', workoutId: 'wa' },
      { userId: ME, displayName: 'Diego', avatarUrl: null, status: 'invited', workoutId: null },
    ],
    createdAt: '2026-10-24T10:00:00.000Z',
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: 'e1',
    userId: ME,
    kind: 'padel',
    title: 'Pádel',
    startDate: '2026-10-28',
    endDate: '2026-10-28',
    startTime: '19:00',
    durationMin: 90,
    severity: 2,
    bodyArea: null,
    notes: null,
    createdAt: '2026-10-24T10:00:00.000Z',
    ...overrides,
  };
}

/** Busy block in LOCAL time (timezone-independent tests). */
export function makeBusy(id: string, start: [number, number, number, number, number], end: [number, number, number, number, number]): BusyBlock {
  const toIso = ([y, mo, d, h, mi]: [number, number, number, number, number]) => new Date(y, mo - 1, d, h, mi).toISOString();
  return { id, userId: ME, start: toIso(start), end: toIso(end), source: 'manual', title: 'Clase', externalId: null };
}

const WEEK_WINDOWS: TrainingWindow[] = [0, 1, 2, 3, 4].flatMap((weekday) => [
  { weekday: weekday as Weekday, start: '07:00', end: '08:30' },
  { weekday: weekday as Weekday, start: '19:00', end: '21:30' },
]);

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: ME,
    username: 'diego',
    displayName: 'Diego',
    avatarUrl: null,
    sports: ['swim', 'bike', 'run', 'strength'],
    level: 'intermediate',
    thresholds: { ftpW: 245, maxHr: 192 },
    availability: {
      weeklyHoursTarget: 10,
      restDay: 0,
      longSessionDays: [5, 6],
      windows: [...WEEK_WINDOWS, { weekday: 5, start: '08:00', end: '13:00' }, { weekday: 6, start: '08:00', end: '13:00' }],
      poolDays: [1, 3, 4],
    },
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
    onboardedAt: '2026-09-01T10:00:00.000Z',
    aiConsentAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

export function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: 'r1',
    userId: ME,
    name: 'Triatlón de Valencia',
    date: '2027-04-18',
    distance: 'half',
    priority: 'A',
    location: null,
    goal: null,
    notes: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}
