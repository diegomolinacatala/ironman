import { useCallback, useEffect, useMemo, useState } from 'react';

import { useProfile, useUpdateProfile, useWorkouts } from '@/data/queries';
import { addDays } from '@/domain/dates';
import {
  applyThresholdSuggestion,
  THRESHOLD_SUGGESTIONS,
  thresholdSuggestions,
  type ThresholdSnoozes,
  type ThresholdSuggestion,
} from '@/domain/thresholdSuggestions';
import type { ISODate } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';

export interface ThresholdSuggestionsState {
  suggestions: ThresholdSuggestion[];
  /** «Actualizar»: saves only that threshold in the profile. */
  accept: (s: ThresholdSuggestion) => Promise<void>;
  /** «Ahora no»: hides it on this device for 3 weeks. */
  snooze: (s: ThresholdSuggestion) => void;
  busy: boolean;
  error: string | null;
}

/** Threshold suggestions from the last 8 weeks (domain/thresholdSuggestions.ts); nothing changes without «Actualizar». */
export function useThresholdSuggestions(today: ISODate): ThresholdSuggestionsState {
  const profile = useProfile();
  const workouts = useWorkouts({ from: addDays(today, -(THRESHOLD_SUGGESTIONS.windowDays - 1)), to: today });
  const update = useUpdateProfile();
  const [snoozes, setSnoozes] = useState<ThresholdSnoozes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readJson<ThresholdSnoozes>(StorageKeys.thresholdSnoozes, {}).then((stored) => {
      if (alive) setSnoozes(stored ?? {});
    });
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(
    // Wait for the snoozes: a hidden suggestion must not flash in.
    () => (snoozes && profile.data && workouts.data ? thresholdSuggestions(profile.data.thresholds, workouts.data, today, snoozes) : []),
    [snoozes, profile.data, workouts.data, today],
  );

  const snooze = useCallback(
    (s: ThresholdSuggestion) => {
      const next = { ...(snoozes ?? {}), [s.field]: today };
      setSnoozes(next);
      void writeJson(StorageKeys.thresholdSnoozes, next);
    },
    [snoozes, today],
  );

  const accept = useCallback(
    async (s: ThresholdSuggestion) => {
      setError(null);
      try {
        await update.mutateAsync({ thresholds: applyThresholdSuggestion(profile.data?.thresholds, s) });
      } catch (err) {
        logger.warn('threshold suggestion save failed', err);
        setError(errorMessage(err, 'No se pudo actualizar. Inténtalo de nuevo.'));
      }
    },
    [update, profile.data?.thresholds],
  );

  return { suggestions, accept, snooze, busy: update.isPending, error };
}
