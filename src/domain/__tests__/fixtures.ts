/** Test builders for domain objects (deterministic ids, fixed timestamps). */
import type {
  BusyBlock,
  DailyCheckin,
  DailyMetrics,
  FriendWeekItem,
  JointSession,
  LifeEvent,
  Profile,
  Race,
  Workout,
} from '../types';

export const NOW = '2026-10-25T10:00:00';
/** Monday of the week after "today" (2026-10-25 is a Sunday). */
export const NEXT_MONDAY = '2026-10-26';

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'me',
    username: 'diego',
    displayName: 'Diego',
    avatarUrl: null,
    sports: ['swim', 'bike', 'run', 'strength'],
    level: 'intermediate',
    thresholds: {},
    availability: {
      weeklyHoursTarget: 9,
      restDay: 0,
      longSessionDays: [5, 6],
      windows: [],
      poolDays: [],
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
    onboardedAt: NOW,
    aiConsentAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

let seq = 0;

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  seq += 1;
  return {
    id: overrides.id ?? `w${seq}`,
    userId: 'me',
    date: NEXT_MONDAY,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: overrides.id ?? 'race-a',
    userId: 'me',
    name: 'Medio de Valencia',
    date: '2027-04-25',
    distance: 'half',
    priority: 'A',
    location: null,
    goal: null,
    notes: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: overrides.id ?? 'ev1',
    userId: 'me',
    kind: 'padel',
    title: 'Pádel con amigos',
    startDate: NEXT_MONDAY,
    endDate: overrides.endDate ?? overrides.startDate ?? NEXT_MONDAY,
    startTime: null,
    durationMin: 90,
    severity: 2,
    bodyArea: null,
    notes: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function makeBusy(start: string, end: string, id = `b-${start}`): BusyBlock {
  return { id, userId: 'me', start, end, source: 'manual', title: 'Clase', externalId: null };
}

export function makeCheckin(overrides: Partial<DailyCheckin> = {}): DailyCheckin {
  return {
    userId: 'me',
    date: '2026-10-25',
    sleepQuality: 4,
    sleepHours: 7.5,
    fatigue: 2,
    soreness: 2,
    stress: 2,
    motivation: 4,
    notes: null,
    ...overrides,
  };
}

export function makeMetrics(date: string, overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    userId: 'me',
    date,
    source: 'garmin',
    hrvMs: 60,
    restingHr: 50,
    sleepHours: 7.5,
    sleepScore: 80,
    bodyBattery: 70,
    trainingReadiness: 75,
    vo2max: 55,
    steps: 9000,
    stressAvg: 30,
    trainingStatus: 'productive',
    ...overrides,
  };
}

export function makeJoint(overrides: Partial<JointSession> = {}): JointSession {
  return {
    id: overrides.id ?? 'joint1',
    organizerId: 'alex',
    sport: 'run',
    date: '2026-10-31',
    startTime: '09:00',
    durationMin: 90,
    intensity: 'endurance',
    title: 'Tirada con Álex',
    location: null,
    notes: null,
    status: 'confirmed',
    participants: [
      { userId: 'alex', displayName: 'Álex', avatarUrl: null, status: 'accepted', workoutId: 'wa' },
      { userId: 'me', displayName: 'Diego', avatarUrl: null, status: 'accepted', workoutId: 'joint-w' },
    ],
    createdAt: NOW,
    ...overrides,
  };
}

export function makeFriendItem(overrides: Partial<FriendWeekItem> = {}): FriendWeekItem {
  return {
    kind: 'workout',
    id: 'f1',
    date: NEXT_MONDAY,
    startTime: null,
    endTime: null,
    durationMin: 60,
    sport: 'run',
    intensity: 'endurance',
    title: 'Rodaje',
    status: 'planned',
    jointSessionId: null,
    ...overrides,
  };
}
