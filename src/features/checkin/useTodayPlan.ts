import { useWorkouts } from '@/data/queries';
import { startOfWeek, weekRange } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import type { PrescriptionContext } from '@/features/coach/prescriptionContext';
import { usePrescriptionContext } from '@/features/coach/usePrescriptionContext';

export interface TodayPlan {
  /** The week of `date` (same query as "Ajustar hoy"); undefined while loading or after a failed load. */
  workouts: Workout[] | undefined;
  /** Thresholds and target race: today's targets in ppm / pace / watts. */
  prescription: PrescriptionContext;
}

/** What the check-in result needs to name today's session and its easier version. */
export function useTodayPlan(date: ISODate): TodayPlan {
  const workouts = useWorkouts(weekRange(startOfWeek(date)));
  const prescription = usePrescriptionContext();
  return { workouts: workouts.data, prescription };
}
