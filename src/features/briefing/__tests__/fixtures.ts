/** Shared briefing fixtures for the briefing tests. */
import type { Briefing, SleepSnapshot } from '@/domain/types';

export const SLEEP: SleepSnapshot = {
  hours: 7 + 20 / 60,
  score: 82,
  deepMin: 92,
  lightMin: 228,
  remMin: 96,
  awakeMin: 24,
  start: '2026-10-26T23:40:00',
  end: '2026-10-27T07:05:00',
  hrvMs: 52,
  hrvBaselineMs: 48,
  restingHr: 47,
  bodyBattery: 76,
};

export const BRIEFING: Briefing = {
  date: '2026-10-27',
  headline: 'Buena noche: hoy toca rodaje suave',
  sleepVerdict: 'good',
  sleepSummary: 'Has dormido siete horas y veinte minutos.',
  script: 'Buenos días Diego. Has dormido bien y hoy toca un rodaje suave de cincuenta minutos en zona dos.',
  focus: 'Bebe agua antes de salir.',
  sleep: SLEEP,
  engine: 'ai',
  createdAt: '2026-10-27T06:30:00.000Z',
};
