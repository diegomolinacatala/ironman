/** Loads the journal answers and the watch metrics behind "Qué te afecta" (Progreso). */
import { useMemo } from 'react';

import { useCheckins, useMetrics, useProfile } from '@/data/queries';
import { addDays } from '@/domain/dates';
import { journalHabitsOf } from '@/domain/habitCatalog';
import { IMPACT_WINDOW_DAYS, habitImpacts, type HabitImpact } from '@/domain/habitImpacts';
import type { ISODate } from '@/domain/types';

/** The readiness of the window's first day needs its own ~30-day baseline. */
const BASELINE_DAYS = 30;

export interface HabitImpactsData {
  /** null while loading; one entry per journal question. */
  impacts: HabitImpact[] | null;
  /** True when no day of the window has watch data (impacts cannot be computed). */
  noWatchData: boolean;
}

export function useHabitImpacts(today: ISODate): HabitImpactsData {
  const from = addDays(today, -(IMPACT_WINDOW_DAYS - 1));
  const checkins = useCheckins({ from, to: today });
  const metrics = useMetrics({ from: addDays(from, -BASELINE_DAYS), to: today });
  const profile = useProfile();
  const impacts = useMemo(() => {
    if (!checkins.data || !metrics.data) return null;
    return habitImpacts({ today, habits: journalHabitsOf(profile.data), checkins: checkins.data, metrics: metrics.data });
  }, [checkins.data, metrics.data, profile.data, today]);
  return { impacts, noWatchData: metrics.data != null && metrics.data.length === 0 };
}
