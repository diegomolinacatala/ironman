/**
 * "Analizar sesión": the stored AI analysis, or asks for one; when the AI is
 * off or unavailable, the rules analysis (`domain/workoutAnalysis`) built
 * from the plan, that morning's check-in and tomorrow's sessions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAnalyzeWorkout, useCheckins, useWorkoutAnalysis, useWorkouts } from '@/data/queries';
import { addDays } from '@/domain/dates';
import type { Workout, WorkoutAnalysis } from '@/domain/types';
import { rulesAnalysis } from '@/domain/workoutAnalysis';
import { errorMessage, logger } from '@/lib/logger';

import type { AthleteTargets } from '../useAthleteTargets';

export interface WorkoutAnalysisFlow {
  /** What to show: the AI analysis, the rules one, or null (not analysed yet). */
  analysis: WorkoutAnalysis | null;
  analyzing: boolean;
  error: string | null;
  /** Asks the coach (again when `refresh`); `saved` = the workout just completed, fresher than the prop. */
  analyze: (refresh?: boolean, saved?: Workout) => void;
}

export function useWorkoutAnalysisFlow(workout: Workout, athlete: AthleteTargets, autoStart: boolean): WorkoutAnalysisFlow {
  const stored = useWorkoutAnalysis(workout.id);
  const mutation = useAnalyzeWorkout();
  const checkins = useCheckins({ from: workout.date, to: workout.date });
  const tomorrow = useWorkouts({ from: addDays(workout.date, 1), to: addDays(workout.date, 1) });
  const [fallback, setFallback] = useState<WorkoutAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const { mutateAsync } = mutation;

  const analyze = useCallback(
    (refresh = false, saved?: Workout) => {
      const target = saved ?? workout;
      setError(null);
      void mutateAsync({ workoutId: target.id, date: target.date, refresh })
        .then((ai) => {
          if (ai) {
            setFallback(null);
            return;
          }
          const checkin = (checkins.data ?? []).find((c) => c.date === target.date) ?? null;
          const next = (tomorrow.data ?? []).filter((w) => w.status === 'planned');
          setFallback(
            rulesAnalysis({ workout: target, thresholds: athlete.thresholds, raceDistance: athlete.raceDistance, checkin, tomorrow: next, now: new Date().toISOString() }),
          );
        })
        .catch((e: unknown) => {
          logger.warn('workout analysis failed', e);
          setError(errorMessage(e, 'No hemos podido analizar la sesión. Inténtalo de nuevo.'));
        });
    },
    [mutateAsync, workout, athlete.thresholds, athlete.raceDistance, checkins.data, tomorrow.data],
  );

  // From "¡Sesión hecha! › Analizar sesión": start once the stored answer is known (no second AI call).
  useEffect(() => {
    if (!autoStart || started.current || stored.isLoading || workout.status !== 'completed') return;
    started.current = true;
    if (!stored.data) analyze();
  }, [autoStart, stored.isLoading, stored.data, workout.status, analyze]);

  return {
    analysis: fallback ?? stored.data ?? null,
    analyzing: mutation.isPending,
    error,
    analyze,
  };
}
