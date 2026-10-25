/**
 * Pure, immutable application of PlanChange[] to an in-memory list of workouts.
 *
 * Used by the demo repository and by the proposal review screen to preview
 * "before → after". The Supabase repository applies the same semantics
 * server-side in the `apply_plan_changes` RPC.
 */
import type { ApplyResult, ISODateTime, PlanChange, UUID, Workout, WorkoutDraft } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DURATION_MIN = 12 * 60;

export interface ApplyContext {
  userId: UUID;
  now: ISODateTime;
  /** Id factory for added workouts (inject for determinism in tests). */
  newId: () => UUID;
}

export function validateDraft(draft: Partial<WorkoutDraft>, partial: boolean): string | null {
  if (!partial || draft.date !== undefined) {
    if (!draft.date || !DATE_RE.test(draft.date)) return 'Fecha inválida';
  }
  if (draft.startTime != null && !TIME_RE.test(draft.startTime)) return 'Hora inválida';
  if (!partial || draft.durationMin !== undefined) {
    const d = draft.durationMin;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > MAX_DURATION_MIN) {
      return 'Duración inválida';
    }
  }
  if (!partial || draft.title !== undefined) {
    if (!draft.title || draft.title.trim().length === 0) return 'Título vacío';
  }
  return null;
}

function draftToWorkout(draft: WorkoutDraft, ctx: ApplyContext): Workout {
  return {
    id: ctx.newId(),
    userId: ctx.userId,
    date: draft.date,
    startTime: draft.startTime ?? null,
    sport: draft.sport,
    title: draft.title.trim(),
    description: draft.description ?? null,
    durationMin: Math.round(draft.durationMin),
    distanceM: draft.distanceM ?? null,
    intensity: draft.intensity,
    tss: draft.tss ?? null,
    steps: draft.steps ?? [],
    status: 'planned',
    completed: null,
    source: draft.source ?? 'manual',
    isKey: draft.isKey ?? false,
    jointSessionId: null,
    externalId: draft.externalId ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

function applyOne(
  workouts: readonly Workout[],
  change: PlanChange,
  ctx: ApplyContext,
): { workouts: Workout[]; error: string | null } {
  if (change.op === 'add') {
    const error = validateDraft(change.workout, false);
    if (error) return { workouts: [...workouts], error };
    return { workouts: [...workouts, draftToWorkout(change.workout, ctx)], error: null };
  }

  const target = workouts.find((w) => w.id === change.workoutId);
  if (!target) return { workouts: [...workouts], error: 'Entreno no encontrado' };
  if (target.status === 'completed' && change.op !== 'update') {
    return { workouts: [...workouts], error: 'No se puede modificar un entreno completado' };
  }

  if (change.op === 'delete') {
    return { workouts: workouts.filter((w) => w.id !== change.workoutId), error: null };
  }

  if (change.op === 'move') {
    const error = validateDraft({ date: change.toDate, startTime: change.toStartTime ?? null }, true);
    if (error) return { workouts: [...workouts], error };
    const moved: Workout = {
      ...target,
      date: change.toDate,
      startTime: change.toStartTime === undefined ? target.startTime : change.toStartTime,
      updatedAt: ctx.now,
    };
    return { workouts: workouts.map((w) => (w.id === target.id ? moved : w)), error: null };
  }

  const error = validateDraft(change.patch, true);
  if (error) return { workouts: [...workouts], error };
  const { source, ...rest } = change.patch;
  const updated: Workout = {
    ...target,
    ...rest,
    title: rest.title?.trim() ?? target.title,
    startTime: rest.startTime === undefined ? target.startTime : rest.startTime,
    description: rest.description === undefined ? target.description : rest.description,
    distanceM: rest.distanceM === undefined ? target.distanceM : rest.distanceM,
    tss: rest.tss === undefined ? target.tss : rest.tss,
    source: source ?? target.source,
    updatedAt: ctx.now,
  };
  return { workouts: workouts.map((w) => (w.id === target.id ? updated : w)), error: null };
}

/**
 * Applies changes in order. A failing change is skipped (reported in `failed`)
 * and does not abort the rest — mirrors the server RPC semantics.
 */
export function applyPlanChanges(
  workouts: readonly Workout[],
  changes: readonly PlanChange[],
  ctx: ApplyContext,
): ApplyResult {
  let current: Workout[] = [...workouts];
  const failed: ApplyResult['failed'] = [];
  let applied = 0;
  changes.forEach((change, index) => {
    const result = applyOne(current, change, ctx);
    current = result.workouts;
    if (result.error) failed.push({ index, error: result.error });
    else applied += 1;
  });
  return { applied, failed, workouts: current };
}

/** Human label (Spanish) for a change, used in proposal review lists. */
export function describeChange(change: PlanChange, workouts: readonly Workout[]): string {
  const title = (id: UUID) => workouts.find((w) => w.id === id)?.title ?? 'entreno';
  switch (change.op) {
    case 'add':
      return `Añadir «${change.workout.title}» el ${change.workout.date}`;
    case 'delete':
      return `Quitar «${title(change.workoutId)}»`;
    case 'move':
      return `Mover «${title(change.workoutId)}» al ${change.toDate}${change.toStartTime ? ` a las ${change.toStartTime}` : ''}`;
    case 'update':
      return `Ajustar «${title(change.workoutId)}»`;
  }
}
