import { describe, expect, test } from '@jest/globals';

import type { Profile } from '@/domain/types';

import { computeTogether } from '../useTogetherWeek';

import { busyBlock, friendItem, workout } from './fixtures';

const RANGE = { from: '2026-10-26', to: '2026-11-01' };

function profile(): Profile {
  return {
    id: 'user-me',
    username: 'diego',
    displayName: 'Diego',
    avatarUrl: null,
    sports: ['run'],
    level: 'intermediate',
    thresholds: {},
    availability: { weeklyHoursTarget: 8, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] },
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
    onboardedAt: '2026-10-01T10:00:00Z',
    aiConsentAt: null,
    createdAt: '2026-10-01T10:00:00Z',
  };
}

describe('computeTogether', () => {
  const base = {
    range: RANGE,
    today: '2026-10-26',
    now: new Date(2026, 9, 26, 6, 0),
    profile: profile(),
  };

  test('finds common slots outside both calendars and a same-sport opportunity', () => {
    const result = computeTogether({
      ...base,
      workouts: [workout({ id: 'sat-run', date: '2026-10-31', startTime: '09:00', durationMin: 90 })],
      blocks: [busyBlock({ start: '2026-10-27T08:00:00', end: '2026-10-27T15:00:00' })],
      friendItems: [
        friendItem({ id: 'alex-run', date: '2026-10-31', sport: 'run', startTime: '09:30', durationMin: 100, title: 'Tirada larga' }),
        friendItem({ id: 'alex-busy', kind: 'busy', date: '2026-10-27', startTime: '17:00', endTime: '20:00', durationMin: null, sport: null, title: null }),
      ],
    });
    expect(result.days).toHaveLength(7);
    expect(result.visibility).toBe('full');
    const tuesday = result.slots.filter((s) => s.date === '2026-10-27');
    // Busy for me 08:00–15:00, for Álex 17:00–20:00 (padded by the travel buffer).
    tuesday.forEach((slot) => {
      expect(slot.start >= '15:00' || slot.end <= '08:00').toBe(true);
      expect(slot.end <= '17:00' || slot.start >= '20:00').toBe(true);
      expect(slot.minutes).toBeGreaterThanOrEqual(45);
    });
    expect(result.opportunities[0]).toMatchObject({ date: '2026-10-31', sport: 'run', myWorkoutId: 'sat-run' });
  });

  test('drops opportunities and slots in the past', () => {
    const result = computeTogether({
      ...base,
      today: '2026-10-30',
      now: new Date(2026, 9, 30, 12, 0),
      workouts: [workout({ id: 'tue', date: '2026-10-27' })],
      blocks: [],
      friendItems: [friendItem({ date: '2026-10-27', sport: 'run' })],
    });
    expect(result.opportunities).toEqual([]);
    expect(result.slots.every((s) => s.date >= '2026-10-30')).toBe(true);
  });
});
