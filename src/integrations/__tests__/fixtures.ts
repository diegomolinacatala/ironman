import type { NotificationPrefs, Workout } from '@/domain/types';

export function workout(overrides: Partial<Workout> & Pick<Workout, 'id' | 'date'>): Workout {
  return {
    userId: 'me',
    startTime: null,
    sport: 'run',
    title: 'Rodaje Z2',
    description: null,
    durationMin: 50,
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

export const prefs: NotificationPrefs = {
  workoutReminders: true,
  reminderMinutesBefore: 30,
  morningSummary: true,
  morningTime: '07:00',
  eveningCheckin: true,
  eveningTime: '21:30',
  weeklyPlanReminder: true,
  social: true,
};
