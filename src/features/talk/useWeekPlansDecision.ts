/**
 * "Guardar en tu plan general" / "Ahora no" for the weeks the coach suggests.
 * Saving writes them to Plan › General and opens it; nothing is saved without a tap.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { useSaveWeekPlans } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { CoachResponse } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { GENERAL_PLAN_HREF, weekPlanSource, weekPlanSuggestion, type WeekPlanSuggestion } from './weekPlanSuggestion';

export type WeekPlansStatus = 'open' | 'saved' | 'dismissed';

export interface WeekPlansDecision {
  suggestion: WeekPlanSuggestion;
  status: WeekPlansStatus;
  isSaving: boolean;
  error: string | null;
  save: () => Promise<void>;
  dismiss: () => void;
  /** Opens Plan › General. */
  openPlan: () => void;
}

function openPlan(): void {
  router.navigate(GENERAL_PLAN_HREF);
}

export function useWeekPlansDecision(response: Pick<CoachResponse, 'weekPlans' | 'engine'>): WeekPlansDecision {
  const saveMutation = useSaveWeekPlans();
  const suggestion = useMemo(() => weekPlanSuggestion(response.weekPlans, todayISO()), [response.weekPlans]);
  const [status, setStatus] = useState<WeekPlansStatus>('open');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (suggestion.drafts.length === 0 || saveMutation.isPending) return;
    setError(null);
    try {
      const source = weekPlanSource(response.engine);
      // Filter again with today's date: a card left open over Sunday night would otherwise send
      // last week's Monday and the whole save would be rejected.
      const drafts = weekPlanSuggestion(response.weekPlans, todayISO()).drafts;
      if (drafts.length === 0) return;
      await saveMutation.mutateAsync(drafts.map((draft) => ({ ...draft, source })));
      haptics.success();
      setStatus('saved');
      openPlan();
    } catch (err) {
      logger.warn('talk save week plans failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No se ha podido guardar tu plan general.'));
    }
  };

  // The button already gives the tap feedback.
  const dismiss = () => {
    setError(null);
    setStatus('dismissed');
  };

  return { suggestion, status, isSaving: saveMutation.isPending, error, save, dismiss, openPlan };
}
