import { useCallback, useEffect, useRef, useState } from 'react';

import { useApplyPlanChanges, useCoach } from '@/data/queries';
import type { ISODate, PlanChange } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { planSummary, weeksToPlan } from './planSummary';

export type PlanPhase = 'working' | 'done' | 'error';

export interface PlanGeneration {
  phase: PlanPhase;
  summary: string[];
  error: string | null;
  retry: () => void;
}

export interface PlanGenerationOptions {
  /** Mondays already generated and applied (persisted): never planned twice, even after a retry or a restart. */
  plannedWeeks: readonly ISODate[];
  onWeekPlanned: (weekStart: ISODate) => void;
}

const FIRST_PLAN_MESSAGE = 'Acabo de empezar con Road to Ironman: prepárame el plan con lo que sabes de mí.';

/**
 * Generates the first plan (this week, plus next week when this one is nearly
 * over) and applies each proposal automatically. The data layer already falls
 * back to the rules engine when the AI coach is unavailable. A retry only runs
 * the weeks that are still missing.
 */
export function usePlanGeneration(today: ISODate, { plannedWeeks, onWeekPlanned }: PlanGenerationOptions): PlanGeneration {
  const coach = useCoach();
  const apply = useApplyPlanChanges();
  const [phase, setPhase] = useState<PlanPhase>('working');
  const [summary, setSummary] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const done = useRef(new Set<ISODate>(plannedWeeks));
  // Changes applied in this session, across retries, for the summary.
  const applied = useRef<PlanChange[]>([]);

  const planWeek = useCallback(
    async (weekStart: ISODate) => {
      const response = await coach.mutateAsync({ mode: 'plan_week', weekStart, message: FIRST_PLAN_MESSAGE });
      const proposal = response.proposal;
      if (proposal && proposal.changes.length > 0) {
        const result = await apply.mutateAsync({ changes: proposal.changes, proposalId: proposal.id });
        const failed = new Set(result.failed.map((f) => f.index));
        applied.current = [...applied.current, ...proposal.changes.filter((_, i) => !failed.has(i))];
      }
      done.current.add(weekStart);
      onWeekPlanned(weekStart);
    },
    [coach, apply, onWeekPlanned],
  );

  const run = useCallback(async () => {
    setPhase('working');
    setError(null);
    try {
      for (const weekStart of weeksToPlan(today)) {
        if (!done.current.has(weekStart)) await planWeek(weekStart);
      }
      setSummary(planSummary(applied.current, today));
      setPhase('done');
      haptics.success();
    } catch (err) {
      logger.warn('onboarding: first plan failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No hemos podido preparar tu plan.'));
      setPhase('error');
    }
  }, [planWeek, today]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return { phase, summary, error, retry: () => void run() };
}
