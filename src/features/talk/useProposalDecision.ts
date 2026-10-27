/**
 * "Aplicar cambios" / "Ahora no" for the proposal of the latest coach answer.
 */
import { useState } from 'react';

import { useApplyPlanChanges, useSetProposalStatus } from '@/data/queries';
import type { PlanProposal } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import type { ProposalResolution } from './talkSession';

export interface ProposalDecision {
  apply: (proposal: PlanProposal) => Promise<void>;
  discard: (proposal: PlanProposal) => Promise<void>;
  isApplying: boolean;
  isDiscarding: boolean;
  error: string | null;
}

export function useProposalDecision(onResolved: (resolution: ProposalResolution) => void): ProposalDecision {
  const applyMutation = useApplyPlanChanges();
  const statusMutation = useSetProposalStatus();
  const [error, setError] = useState<string | null>(null);

  const apply = async (proposal: PlanProposal) => {
    setError(null);
    try {
      const res = await applyMutation.mutateAsync({ changes: proposal.changes, proposalId: proposal.id });
      const failed = res.failed.length;
      if (res.applied > 0 && failed > 0) {
        await statusMutation
          .mutateAsync({ id: proposal.id, status: 'partially_applied' })
          .catch((err: unknown) => logger.warn('could not mark proposal partially applied', err));
      }
      if (failed === 0) haptics.success();
      else haptics.warning();
      onResolved({ kind: 'applied', applied: res.applied, failed });
    } catch (err) {
      logger.warn('talk apply plan changes failed', err);
      setError(errorMessage(err, 'No se han podido aplicar los cambios.'));
    }
  };

  const discard = async (proposal: PlanProposal) => {
    setError(null);
    try {
      await statusMutation.mutateAsync({ id: proposal.id, status: 'discarded' });
      haptics.tap();
      onResolved({ kind: 'discarded' });
    } catch (err) {
      logger.warn('talk discard proposal failed', err);
      setError(errorMessage(err, 'No se ha podido descartar la propuesta.'));
    }
  };

  return {
    apply,
    discard,
    isApplying: applyMutation.isPending,
    isDiscarding: statusMutation.isPending && !applyMutation.isPending,
    error,
  };
}
