/**
 * State + actions of the proposal review screen: selection, in-memory
 * preview, apply (selected subset) and discard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/data/context';
import { useApplyPlanChanges, useJointSessions, useSetProposalStatus, useWorkouts } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { JointSession, PlanProposal, UUID, Workout } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import {
  buildDiffRows,
  isChangeApplied,
  mapFailures,
  pickChanges,
  previewTotals,
  proposalSpan,
  selectedIndexes,
  statusAfterApply,
  type DiffRow,
  type PreviewResult,
} from './proposalDiff';
import { usePrescriptionContext } from './usePrescriptionContext';

export interface ApplyOutcome {
  applied: number;
  failed: { index: number; error: string }[];
}

export interface ProposalReview {
  rows: DiffRow[];
  selected: boolean[];
  selectedCount: number;
  /** Partially applied proposals: changes already in the plan (not offered again). */
  applied: boolean[];
  /** The proposal was partially applied: the rest can be retried. */
  isRetry: boolean;
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
  // Every day the changes touch (proposals span 14 days, often across two weeks).
  const range = useMemo(() => proposalSpan(proposal), [proposal]);
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
  // Frozen at open: the status refresh after applying must not change how rows read.
  const [isRetry] = useState(proposal.status === 'partially_applied');
  // A partially applied proposal offers again only what is not in the plan yet.
  // Judged on the week before this screen applied anything (the snapshot), so rows keep their state after a retry.
  const applied = useMemo(
    () => proposal.changes.map((c) => isRetry && week !== undefined && isChangeApplied(c, week)),
    [proposal.changes, isRetry, week],
  );
  // Opened as a retry: once the week loads, preselect only what is missing (never after an apply on this screen).
  const pendingSeed = useRef(isRetry);
  useEffect(() => {
    if (!pendingSeed.current || workouts.data === undefined) return;
    pendingSeed.current = false;
    setSelected(applied.map((done) => !done));
  }, [applied, workouts.data]);
  const names = useMemo(() => partnerNames(joints.data ?? [], session?.userId ?? null), [joints.data, session?.userId]);
  // Thresholds + target race turn the zones of new sessions into ppm / pace / watts.
  const prescription = usePrescriptionContext();
  const rows = useMemo(
    () => buildDiffRows(proposal.changes, week ?? [], names, prescription),
    [proposal.changes, week, names, prescription],
  );
  const indexes = selectedIndexes(selected.map((on, i) => on && !applied[i]));
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
      const status = statusAfterApply({ status: isRetry ? 'partially_applied' : proposal.status, alreadyApplied: applied, indexes, applied: res.applied, failedCount: failed.length });
      if (status) {
        await statusMutation
          .mutateAsync({ id: proposal.id, status })
          .catch((err: unknown) => logger.warn(`could not mark proposal ${status}`, err));
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
    selected: selected.map((on, i) => on && !applied[i]),
    selectedCount: indexes.length,
    applied,
    isRetry,
    toggle: (index) => setSelected((prev) => prev.map((on, i) => (i === index && !applied[i] ? !on : on))),
    setAll: (on) => setSelected((prev) => prev.map((_, i) => on && !applied[i])),
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
