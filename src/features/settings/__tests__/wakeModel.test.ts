import { describe, expect, test } from '@jest/globals';

import type { DailyMetrics, NotificationPrefs } from '@/domain/types';

import { learnedFromMetrics, localWakesFromMetrics, morningSubtitle, wakeWindowView } from '../wakeModel';

const PREFS: NotificationPrefs = {
  workoutReminders: true,
  reminderMinutesBefore: 30,
  morningSummary: true,
  morningTime: '07:30',
  eveningCheckin: true,
  eveningTime: '21:30',
  weeklyPlanReminder: true,
  social: true,
  morningMode: 'wake',
};

/** A night of `date` (local) ending at h:m local time. */
function night(day: number, h: number, m: number): DailyMetrics {
  const end = new Date(2026, 10, day, h, m);
  return {
    userId: 'u1',
    date: `2026-11-${String(day).padStart(2, '0')}`,
    source: 'healthkit',
    hrvMs: null,
    restingHr: null,
    sleepHours: 7.5,
    sleepScore: null,
    bodyBattery: null,
    trainingReadiness: null,
    vo2max: null,
    steps: null,
    stressAvg: null,
    trainingStatus: null,
    sleepStart: new Date(end.getTime() - 7.5 * 3_600_000).toISOString(),
    sleepEnd: end.toISOString(),
  };
}

/** 5–25 Nov: weekdays at 06:40, weekends at 08:30 (Nov 26 2026 is a Thursday). */
function history(): DailyMetrics[] {
  const rows: DailyMetrics[] = [];
  for (let day = 5; day <= 25; day += 1) {
    const dow = new Date(2026, 10, day).getDay();
    rows.push(dow === 0 || dow === 6 ? night(day, 8, 30) : night(day, 6, 40));
  }
  return rows;
}

describe('wake-mode settings model', () => {
  test('device-local wake-ups from the nights with an end', () => {
    expect(localWakesFromMetrics([night(25, 6, 40), { ...night(24, 6, 0), sleepEnd: null }])).toEqual([{ date: '2026-11-25', minutes: 400 }]);
  });

  test('weekday and weekend franjas from the watch', () => {
    const view = wakeWindowView(PREFS, learnedFromMetrics(history(), '2026-11-26'), '2026-11-26');
    expect(view.source).toBe('learned');
    expect(view.windowText).toBe('Tu franja de despertar, según tu reloj: entre semana, de 06:10 a 07:40; el fin de semana, de 08:00 a 09:30.');
    expect(view.fallbackText).toBe('Si tu reloj no dice nada, te llega a las 07:40.');
  });

  test('one franja when weekdays and weekends match', () => {
    const same = history().map((n) => ({ ...n, sleepEnd: new Date(new Date(n.sleepEnd ?? '').setHours(7, 0)).toISOString() }));
    expect(wakeWindowView(PREFS, learnedFromMetrics(same, '2026-11-26'), '2026-11-26').windowText).toBe(
      'Tu franja de despertar, según tu reloj: entre 06:30 y 08:00.',
    );
  });

  test('the row subtitle says the mode', () => {
    expect(morningSubtitle({ morningMode: 'wake', wakeDelayMin: 10, morningTime: '07:30' })).toBe('Al despertar, 10 min después: cómo has dormido y qué toca.');
    expect(morningSubtitle({ morningTime: '07:30' })).toBe('Cada día a las 07:30: cómo has dormido y qué toca.');
  });
});
