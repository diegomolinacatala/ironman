import { describe, expect, test } from '@jest/globals';

import { addDays } from '@/domain/dates';

import {
  buildSchedule,
  isLocalNotificationKind,
  leadLabel,
  MAX_SCHEDULED,
  urlFromNotificationData,
  type NotificationSpec,
} from '../notifications/schedule';
import { prefs, workout } from './fixtures';

// Monday 26 Oct 2026, 06:00 local.
const TODAY = '2026-10-26';
const NOW = new Date(2026, 9, 26, 6, 0);

function dateOf(spec: NotificationSpec | undefined): Date {
  if (!spec || spec.trigger.type !== 'date') throw new Error('expected a date trigger');
  return spec.trigger.date;
}

describe('buildSchedule', () => {
  test('schedules a reminder reminderMinutesBefore a timed workout', () => {
    const w = workout({ id: 'w1', date: TODAY, startTime: '18:30', title: 'Series 6x1000' });
    const specs = buildSchedule({ workouts: [w], prefs, today: TODAY, now: NOW });
    const reminder = specs.find((s) => s.kind === 'workout_reminder');
    expect(reminder).toBeDefined();
    expect(dateOf(reminder)).toEqual(new Date(2026, 9, 26, 18, 0));
    expect(reminder?.title).toBe('Series 6x1000 en 30 min');
    expect(reminder?.url).toBe('/workout/w1');
    expect(reminder?.id).toBe('rti.workout.w1');
    expect(reminder?.categoryId).toBe('workout');
  });

  test('untimed workouts get a 07:30 reminder only when the morning summary is off', () => {
    const w = workout({ id: 'w2', date: TODAY });
    const withSummary = buildSchedule({ workouts: [w], prefs, today: TODAY, now: NOW });
    expect(withSummary.filter((s) => s.kind === 'workout_reminder')).toHaveLength(0);

    const noSummary = buildSchedule({ workouts: [w], prefs: { ...prefs, morningSummary: false }, today: TODAY, now: NOW });
    const reminder = noSummary.find((s) => s.kind === 'workout_reminder');
    expect(dateOf(reminder)).toEqual(new Date(2026, 9, 26, 7, 30));
    expect(reminder?.title).toBe('Hoy toca: Rodaje Z2');
  });

  test('skips past, completed, skipped and rest sessions', () => {
    const workouts = [
      workout({ id: 'past', date: TODAY, startTime: '06:10' }),
      workout({ id: 'done', date: TODAY, startTime: '19:00', status: 'completed' }),
      workout({ id: 'skip', date: TODAY, startTime: '19:00', status: 'skipped' }),
      workout({ id: 'rest', date: TODAY, startTime: '19:00', sport: 'rest' }),
    ];
    const specs = buildSchedule({ workouts, prefs, today: TODAY, now: NOW });
    expect(specs.filter((s) => s.kind === 'workout_reminder')).toHaveLength(0);
  });

  test('the morning notification invites to listen to the briefing every day at morningTime', () => {
    const workouts = [
      workout({ id: 'a', date: TODAY, startTime: '07:30', title: 'Natación técnica', sport: 'swim', durationMin: 45 }),
      workout({ id: 'b', date: TODAY, startTime: '19:00', title: 'Rodaje Z2', durationMin: 50 }),
    ];
    const specs = buildSchedule({ workouts, prefs, today: TODAY, now: NOW, days: 2 });
    const summaries = specs.filter((s) => s.kind === 'morning_summary');
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.title).toBe('Tu informe de hoy');
    expect(summaries[0]?.body).toBe('Toca para escuchar cómo has dormido y qué te toca hoy');
    expect(summaries[0]?.url).toBe('/briefing?play=1');
    expect(dateOf(summaries[0])).toEqual(new Date(2026, 9, 26, 7, 0));
    expect(summaries[1]?.title).toBe('Tu informe de hoy');
    expect(summaries[1]?.url).toBe('/briefing?play=1');
  });

  test('the morning briefing follows morningTime and is off with morningSummary off', () => {
    const late = buildSchedule({ workouts: [], prefs: { ...prefs, morningTime: '08:15' }, today: TODAY, now: NOW, days: 1 });
    expect(dateOf(late.find((s) => s.kind === 'morning_summary'))).toEqual(new Date(2026, 9, 26, 8, 15));
    const off = buildSchedule({ workouts: [], prefs: { ...prefs, morningSummary: false }, today: TODAY, now: NOW });
    expect(off.some((s) => s.kind === 'morning_summary')).toBe(false);
  });

  test('evening check-in is one daily repeating notification', () => {
    const specs = buildSchedule({ workouts: [], prefs, today: TODAY, now: NOW });
    const checkins = specs.filter((s) => s.kind === 'evening_checkin');
    expect(checkins).toHaveLength(1);
    expect(checkins[0]?.trigger).toEqual({ type: 'daily', hour: 21, minute: 30 });
    expect(checkins[0]?.url).toBe('/checkin');
  });

  test('weekly plan reminder fires on the next two Sundays at 19:00 and opens next week in Semana', () => {
    const specs = buildSchedule({ workouts: [], prefs, today: TODAY, now: NOW });
    const weekly = specs.filter((s) => s.kind === 'weekly_plan');
    expect(weekly).toHaveLength(2);
    expect(dateOf(weekly[0])).toEqual(new Date(2026, 10, 1, 19, 0));
    expect(weekly[0]?.url).toBe('/week?week=2026-11-02');
    expect(dateOf(weekly[1])).toEqual(new Date(2026, 10, 8, 19, 0));
    expect(weekly[1]?.url).toBe('/week?week=2026-11-09');
  });

  test('no local notification deep-links into the coach (a tap must never start an AI request)', () => {
    const w = workout({ id: 'w1', date: TODAY, startTime: '18:30' });
    const specs = buildSchedule({ workouts: [w], prefs: { ...prefs, morningSummary: false }, today: TODAY, now: NOW });
    expect(specs.length).toBeGreaterThan(0);
    specs.forEach((s) => expect(s.url.startsWith('/coach')).toBe(false));
  });

  test('respects disabled preferences', () => {
    const w = workout({ id: 'w1', date: TODAY, startTime: '18:30' });
    const off = {
      ...prefs,
      workoutReminders: false,
      morningSummary: false,
      eveningCheckin: false,
      weeklyPlanReminder: false,
    };
    expect(buildSchedule({ workouts: [w], prefs: off, today: TODAY, now: NOW })).toEqual([]);
  });

  test('never exceeds the iOS pending limit and keeps the soonest', () => {
    const workouts = Array.from({ length: 7 * 12 }, (_, i) =>
      workout({
        id: `w${i}`,
        date: addDays(TODAY, Math.floor(i / 12)),
        startTime: `${String(8 + (i % 12)).padStart(2, '0')}:00`,
      }),
    );
    const specs = buildSchedule({ workouts, prefs, today: TODAY, now: NOW });
    expect(specs.length).toBe(MAX_SCHEDULED);
    const dated = specs.filter((s) => s.trigger.type === 'date').map((s) => dateOf(s).getTime());
    expect([...dated].sort((a, b) => a - b)).toEqual(dated);
  });

  test('category ids never contain ":" or "-"', () => {
    const w = workout({ id: 'w1', date: TODAY, startTime: '18:30' });
    const specs = buildSchedule({ workouts: [w], prefs, today: TODAY, now: NOW });
    specs.forEach((s) => expect(s.categoryId).toMatch(/^[a-z]+$/));
  });
});

describe('helpers', () => {
  test('leadLabel formats minutes and hours', () => {
    expect(leadLabel(30)).toBe('30 min');
    expect(leadLabel(60)).toBe('1 h');
    expect(leadLabel(90)).toBe('1 h 30 min');
  });

  test('urlFromNotificationData only accepts in-app paths', () => {
    expect(urlFromNotificationData({ url: '/joint/123' })).toBe('/joint/123');
    expect(urlFromNotificationData({ url: 'https://evil.example' })).toBeNull();
    expect(urlFromNotificationData({ url: '//evil.example' })).toBeNull();
    expect(urlFromNotificationData({ jointSessionId: 'x' })).toBeNull();
    expect(urlFromNotificationData(null)).toBeNull();
  });

  test('isLocalNotificationKind recognises our kinds', () => {
    expect(isLocalNotificationKind('morning_summary')).toBe(true);
    expect(isLocalNotificationKind('joint_invite')).toBe(false);
    expect(isLocalNotificationKind(undefined)).toBe(false);
  });
});
