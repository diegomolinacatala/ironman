import { useMemo } from 'react';

import { useCheckins, useLifeEvents, useMetrics } from '@/data/queries';
import { addDays } from '@/domain/dates';
import { STRESS_SLEEP, stressSleepSignal, type StressSleepSignal } from '@/domain/stressSleep';
import type { DailyCheckin, DailyMetrics, ISODate, LifeEvent } from '@/domain/types';

/** Baseline (28 days) + the three-day window. */
export const STRESS_SLEEP_METRICS_DAYS = STRESS_SLEEP.baselineMaxDays + STRESS_SLEEP.windowDays;

/** Ranges the signal of `today` reads (metrics, check-ins, life events). */
export function stressSleepRanges(today: ISODate) {
  return {
    metrics: { from: addDays(today, -STRESS_SLEEP_METRICS_DAYS), to: today },
    checkins: { from: addDays(today, -STRESS_SLEEP.windowDays), to: today },
    events: { from: addDays(today, -STRESS_SLEEP.examPeriodDays), to: addDays(today, STRESS_SLEEP.examPeriodDays) },
  };
}

/** The signal from loaded data (device time zone); null while anything is missing. */
export function stressSleepFrom(
  today: ISODate,
  metrics: readonly DailyMetrics[] | undefined,
  checkins: readonly DailyCheckin[] | undefined,
  lifeEvents: readonly LifeEvent[] | undefined,
): StressSleepSignal | null {
  if (!metrics) return null;
  return stressSleepSignal({ today, metrics, checkins: checkins ?? [], lifeEvents: lifeEvents ?? [] });
}

/**
 * Stress that is costing the athlete sleep, today (domain/stressSleep.ts): the
 * watch's stress, the check-in and exams against the last nights. Null without
 * data or when there is nothing to say.
 */
export function useStressSleep(today: ISODate): StressSleepSignal | null {
  const ranges = useMemo(() => stressSleepRanges(today), [today]);
  const metrics = useMetrics(ranges.metrics).data;
  const checkins = useCheckins(ranges.checkins).data;
  const events = useLifeEvents(ranges.events).data;
  return useMemo(() => stressSleepFrom(today, metrics, checkins, events), [today, metrics, checkins, events]);
}
