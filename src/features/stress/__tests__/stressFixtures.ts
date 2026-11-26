import type { StressSleepSignal } from '@/domain/stressSleep';

/** A moderate stress-and-sleep signal of `date` (1 h less sleep, usual bedtime 23:00). */
export function stressSignal(date: string, overrides: Partial<StressSleepSignal> = {}): StressSleepSignal {
  return {
    date,
    level: 'moderate',
    exam: false,
    flaggedNights: 2,
    stressDays: 2,
    worse: { kind: 'hours', amount: 60 },
    usualBedtimeMin: 23 * 60,
    easeDays: 2,
    headline: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual',
    advice: 'hoy suave y acuéstate antes',
    message: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual: hoy suave y acuéstate antes.',
    reasons: [],
    nights: [],
    ...overrides,
  };
}
