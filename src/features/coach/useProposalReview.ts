/**
 * State + actions of the proposal review screen: selection, in-memory
 * preview, apply (selected subset) and discard.
 */
import { useMemo, useState } from 'react';

import { useAuth } from '@/data/context';
import { useApplyPlanChanges, useJointSessions, useSetProposalStatus, useWorkouts } from '@/data/queries';
import { todayISO, weekRange } from '@/domain/dates';
import type { JointSession, PlanProposal, UUID, Workout } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import {
  buildDiffRows,
  mapFailures,
  pickChanges,
  previewTotals,
  selectedIndexes,
  type DiffRow,
  type PreviewResult,
} from './proposalDiff';

export interface ApplyOutcome {
  applied: number;
  failed: { index: number; error: string }[];
}

export interface ProposalReview {
  rows: DiffRow[];
  selected: boolean[];
  selectedCount: number;
  toggle: (index: number) => void;
  setAll: (on: boolean) => void;
  preview: PreviewResult | null;
  isLoadingWeek: boolean;
  weekError: string | null;
  reloadWeek: () => void;
  outcome: ApplyOutcome | null;
  actionError: string | null;
  isApplying: boolean;
  isDiscarding: boolean;
  apply: () => Promise<void>;
  discard: () => Promise<boolean>;
}

function partnerNames(sessions: readonly JointSession[], me: UUID | null): Record<UUID, string> {
  return Object.fromEntries(
    sessions.map((s) => {
      const others = s.participants.filter((p) => p.userId !== me).map((p) => p.displayName.split(/\s+/)[0] ?? '');
      return [s.id, others.filter(Boolean).join(', ')];
    }),
  );
}

export function useProposalReview(proposal: PlanProposal): ProposalReview {
  const { session } = useAuth();
  const range = weekRange(proposal.weekStart);
  const workouts = useWorkouts(range);
  const joints = useJointSessions(range);
  const applyMutation = useApplyPlanChanges();
  const statusMutation = useSetProposalStatus();
  const [selected, setSelected] = useState<boolean[]>(() => proposal.changes.map(() => true));
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);
  const [isDiscarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Week as it was when the changes were applied, so rows keep their "before".
  const [snapshot, setSnapshot] = useState<Workout[] | null>(null);

  const week = snapshot ?? workouts.data;
  const names = useMemo(() => partnerNames(joints.data ?? [], session?.userId ?? null), [joints.data, session?.userId]);
  const rows = useMemo(() => buildDiffRows(proposal.changes, week ?? [], names), [proposal.changes, week, names]);
  const indexes = selectedIndexes(selected);
  const preview = week
    ? previewTotals({
        workouts: week,
        changes: proposal.changes,
        indexes,
        weekStart: proposal.weekStart,
        today: todayISO(),
        userId: proposal.userId,
      })
    : null;

  const apply = async () => {
    setActionError(null);
    const before = workouts.data ?? null;
    try {
      const res = await applyMutation.mutateAsync({ changes: pickChanges(proposal.changes, indexes), proposalId: proposal.id });
      const failed = mapFailures(indexes, res.failed);
      const partial = res.applied > 0 && (failed.length > 0 || indexes.length < proposal.changes.length);
      if (partial) {
        await statusMutation
          .mutateAsync({ id: proposal.id, status: 'partially_applied' })
          .catch((err: unknown) => logger.warn('could not mark proposal partially applied', err));
      }
      setSnapshot(before);
      setOutcome({ applied: res.applied, failed });
      if (failed.length === 0) haptics.success();
      else haptics.warning();
    } catch (err) {
      logger.warn('apply plan changes failed', err);
      setActionError(errorMessage(err, 'No se han podido aplicar los cambios.'));
    }
  };

  const discard = async (): Promise<boolean> => {
    setActionError(null);
    setDiscarding(true);
    try {
      await statusMutation.mutateAsync({ id: proposal.id, status: 'discarded' });
      return true;
    } catch (err) {
      logger.warn('discard proposal failed', err);
      setActionError(errorMessage(err, 'No se ha podido descartar la propuesta.'));
      return false;
    } finally {
      setDiscarding(false);
    }
  };

  return {
    rows,
    selected,
    selectedCount: indexes.length,
    toggle: (index) => setSelected((prev) => prev.map((on, i) => (i === index ? !on : on))),
    setAll: (on) => setSelected((prev) => prev.map(() => on)),
    preview,
    isLoadingWeek: workouts.isLoading,
    weekError: workouts.error ? errorMessage(workouts.error) : null,
    reloadWeek: () => void workouts.refetch(),
    outcome,
    actionError,
    isApplying: applyMutation.isPending,
    isDiscarding,
    apply,
    discard,
  };
}
