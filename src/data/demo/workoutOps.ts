/**
 * Pure workout/plan helpers shared by the demo repository and the Supabase
 * repository (kept here because `src/data/demo/**` is the local engine).
 */
import type {
  CompletedData,
  DateRange,
  ISODate,
  PlanChange,
  ProposalStatus,
  WorkoutPatch,
} from '@/domain/types';

import { RepositoryError } from '../repository';

export function validateCompleted(data: CompletedData): void {
  if (data.rpe !== undefined && (!Number.isFinite(data.rpe) || data.rpe < 1 || data.rpe > 10)) {
    throw new RepositoryError('validation', 'El esfuerzo percibido (RPE) va de 1 a 10.');
  }
  if (data.durationMin !== undefined && (!Number.isFinite(data.durationMin) || data.durationMin < 0 || data.durationMin > 720)) {
    throw new RepositoryError('validation', 'La duración debe estar entre 0 y 720 minutos.');
  }
  if (data.distanceM !== undefined && (!Number.isFinite(data.distanceM) || data.distanceM < 0)) {
    throw new RepositoryError('validation', 'La distancia no es válida.');
  }
}

export function completionPatch(data: CompletedData, now: string): WorkoutPatch {
  validateCompleted(data);
  return {
    status: 'completed',
    completed: { source: 'manual', ...data, completedAt: data.completedAt ?? now },
  };
}

export function skipPatch(reason?: string): WorkoutPatch {
  const note = reason?.trim();
  return { status: 'skipped', completed: note ? { notes: note.slice(0, 500) } : null };
}

export const RESET_PATCH: WorkoutPatch = { status: 'planned', completed: null };

/** Status a proposal gets after applying (null = leave as is). Mirrors the RPC. */
/**
 * Mirrors the SQL rule: 'applied' only when nothing failed AND every change of the
 * proposal was applied (the user may apply a subset); otherwise 'partially_applied'.
 */
export function proposalStatusAfterApply(
  applied: number,
  failed: number,
  proposalChangeCount: number = applied,
): ProposalStatus | null {
  if (failed === 0 && applied >= proposalChangeCount) return 'applied';
  if (applied > 0) return 'partially_applied';
  return null;
}

/** Dates touched by a list of changes (targets of add/move/update-with-date). */
export function changeDates(changes: readonly PlanChange[]): ISODate[] {
  return changes.flatMap((c) => {
    if (c.op === 'add') return [c.workout.date];
    if (c.op === 'move') return [c.toDate];
    if (c.op === 'update' && c.patch.date) return [c.patch.date];
    return [];
  });
}

export function changeWorkoutIds(changes: readonly PlanChange[]): string[] {
  return changes.flatMap((c) => (c.op === 'add' ? [] : [c.workoutId]));
}

/** Smallest range covering the given dates, or null when empty. */
export function rangeOf(dates: readonly ISODate[]): DateRange | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}
