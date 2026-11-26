import { useMemo } from 'react';

import { FITNESS_WEEKS } from '@/domain/constants';
import { addDays, startOfWeek } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { useWorkouts } from '@/data/queries';

import { recentWeeklyMinutes } from './weekModel';

/**
 * Completed minutes of the FITNESS_WEEKS weeks before the current week (oldest
 * first): the athlete's volume today. The week view, the planner, Plan →
 * General, Hoy and Progreso pass it to the periodization, so a short-notice
 * plan shows the same base and build weeks everywhere. Empty while loading.
 */
export function useFitnessMinutes(today: ISODate): number[] {
  const monday = startOfWeek(today);
  const workouts = useWorkouts({ from: addDays(monday, -7 * FITNESS_WEEKS), to: addDays(monday, -1) });
  return useMemo(() => (workouts.data ? recentWeeklyMinutes(workouts.data, monday, FITNESS_WEEKS, addDays) : []), [workouts.data, monday]);
}
