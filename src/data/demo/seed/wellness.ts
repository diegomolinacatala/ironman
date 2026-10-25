import { addDays, weekdayOf } from '@/domain/dates';
import type { DailyCheckin, DailyMetrics, ISODate, NutritionLog, Score5, UUID } from '@/domain/types';

import type { DemoClock } from '../db';
import { localIso } from '../ids';

const DAYS = 28;

function score(value: number): Score5 {
  return Math.min(5, Math.max(1, Math.round(value))) as Score5;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const CHECKIN_NOTES: Record<number, string> = {
  2: 'Piernas cargadas después de la tirada larga.',
  9: 'Semana de entregas en el máster, algo de estrés.',
  16: 'Dormí fatal por el calor.',
};

/** 28 days of check-ins ending yesterday (today's is left for the user). */
export function seedCheckins(userId: UUID, today: ISODate, rand: () => number): DailyCheckin[] {
  return Array.from({ length: DAYS }, (_, i) => {
    const date = addDays(today, -(DAYS - i));
    const weekday = weekdayOf(date);
    const afterLongDay = weekday === 6 || weekday === 0;
    const busyWeekday = weekday >= 1 && weekday <= 4;
    const daysAgo = DAYS - i;
    return {
      userId,
      date,
      sleepQuality: score(3.4 + rand() * 1.6),
      sleepHours: round1(6.4 + rand() * 1.8),
      fatigue: score((afterLongDay ? 3 : 2) + rand() * 0.9),
      soreness: score((afterLongDay ? 2.6 : 1.4) + rand() * 1),
      stress: score((busyWeekday ? 2.5 : 1.6) + rand() * 1),
      motivation: score(3.5 + rand() * 1.5),
      notes: CHECKIN_NOTES[daysAgo] ?? null,
    };
  });
}

/** 28 days of Garmin metrics ending today (HRV ~60–75 ms, RHR ~48–52). */
export function seedMetrics(userId: UUID, today: ISODate, rand: () => number): DailyMetrics[] {
  return Array.from({ length: DAYS }, (_, i) => {
    const date = addDays(today, -(DAYS - 1 - i));
    const trend = Math.sin(i / 4) * 3;
    const hrv = round1(67 + trend + (rand() - 0.5) * 8);
    const sleepHours = round1(6.6 + rand() * 1.6);
    return {
      userId,
      date,
      source: 'garmin',
      hrvMs: Math.min(75, Math.max(60, hrv)),
      restingHr: Math.min(52, Math.max(48, Math.round(50 - trend / 2 + (rand() - 0.5) * 3))),
      sleepHours,
      sleepScore: Math.round(62 + (sleepHours - 6.5) * 12 + rand() * 8),
      bodyBattery: Math.round(58 + rand() * 32),
      trainingReadiness: Math.round(52 + trend * 3 + rand() * 30),
      vo2max: 54,
      steps: Math.round(7500 + rand() * 6500),
      stressAvg: Math.round(22 + rand() * 14),
      trainingStatus: i > DAYS - 8 ? 'Productivo' : 'Mantenimiento',
    };
  });
}

export function seedNutrition(userId: UUID, today: ISODate, clock: DemoClock): NutritionLog[] {
  const yesterday = addDays(today, -1);
  const entries: Omit<NutritionLog, 'id' | 'userId' | 'createdAt'>[] = [
    { date: yesterday, meal: 'breakfast', description: 'Avena con plátano, nueces y yogur griego', kcal: 620, carbsG: 85, proteinG: 28, fatG: 18 },
    { date: yesterday, meal: 'lunch', description: 'Arroz con pollo, pimiento y calabacín', kcal: 780, carbsG: 105, proteinG: 45, fatG: 16 },
    { date: yesterday, meal: 'post', description: 'Batido de proteína con leche y un plátano', kcal: 340, carbsG: 38, proteinG: 30, fatG: 6 },
    { date: yesterday, meal: 'dinner', description: 'Tortilla de patata y ensalada', kcal: 650, carbsG: 48, proteinG: 26, fatG: 36 },
    { date: today, meal: 'breakfast', description: 'Tostadas con tomate, aceite y jamón + café', kcal: 520, carbsG: 62, proteinG: 24, fatG: 18 },
  ];
  return entries.map((e) => ({
    ...e,
    id: clock.newId(),
    userId,
    createdAt: localIso(e.date, e.meal === 'breakfast' ? '08:00' : e.meal === 'lunch' ? '14:30' : '21:00'),
  }));
}
