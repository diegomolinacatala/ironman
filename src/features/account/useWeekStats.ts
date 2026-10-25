import { useMemo } from 'react';

import { useWorkouts } from '@/data/queries';
import { startOfWeek, todayISO, weekRange } from '@/domain/dates';
import { weekSummary } from '@/domain/load';

export interface WeekStats {
  isLoading: boolean;
  isError: boolean;
  completedMin: number;
  plannedMin: number;
  /** 0..1, or null when nothing was due yet. */
  compliancePct: number | null;
  sessions: number;
  completedSessions: number;
  refetch: () => void;
}

/** This week's totals (Mon–Sun) for the Yo header. */
export function useWeekStats(): WeekStats {
  const today = todayISO();
  const weekStart = startOfWeek(today);
  const range = useMemo(() => weekRange(weekStart), [weekStart]);
  const workouts = useWorkouts(range);
  const summary = useMemo(
    () => (workouts.data ? weekSummary(workouts.data, weekStart, today) : null),
    [workouts.data, weekStart, today],
  );
  return {
    isLoading: workouts.isLoading,
    isError: workouts.isError,
    completedMin: summary?.completedMin ?? 0,
    plannedMin: summary?.plannedMin ?? 0,
    compliancePct: summary?.compliancePct ?? null,
    sessions: summary?.sessions ?? 0,
    completedSessions: summary?.completedSessions ?? 0,
    refetch: () => void workouts.refetch(),
  };
}
