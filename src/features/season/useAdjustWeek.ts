import { useState } from 'react';

import type { ISODate, WeekPlanDraft } from '@/domain/types';
import { useDeleteWeekPlan, useSaveWeekPlans } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

export interface AdjustWeekActions {
  /** Saves the week's plan; true when it worked. */
  save: (draft: WeekPlanDraft) => Promise<boolean>;
  /** Back to what the periodization says; true when it worked. */
  remove: (weekStart: ISODate) => Promise<boolean>;
  saving: boolean;
  removing: boolean;
  error: string | null;
  clearError: () => void;
}

/** Save / remove a week-level plan ("Ajustar semana") with haptics and a readable error. */
export function useAdjustWeek(): AdjustWeekActions {
  const saveMutation = useSaveWeekPlans();
  const deleteMutation = useDeleteWeekPlan();
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<unknown>, what: string, fallback: string): Promise<boolean> => {
    setError(null);
    try {
      await task();
      haptics.success();
      return true;
    } catch (err) {
      logger.warn(`season: ${what} failed`, err);
      haptics.warning();
      setError(errorMessage(err, fallback));
      return false;
    }
  };

  return {
    save: (draft) => run(() => saveMutation.mutateAsync([draft]), 'save week plan', 'No se ha podido guardar el ajuste.'),
    remove: (weekStart) => run(() => deleteMutation.mutateAsync(weekStart), 'delete week plan', 'No se ha podido quitar el ajuste.'),
    saving: saveMutation.isPending,
    removing: deleteMutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
