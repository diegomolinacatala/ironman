/**
 * Pure, immutable application of PlanChange[] to an in-memory list of workouts.
 *
 * Used by the demo repository and by the proposal review screen to preview
 * "before → after". The Supabase repository applies the same semantics
 * server-side in the `apply_plan_changes` RPC.
 */
import type { ApplyResult, ISODateTime, PlanChange, UUID, Workout, WorkoutCoaching, WorkoutDraft } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DURATION_MIN = 12 * 60;
/** Same limits and messages as the server (`20261109000100_coach_v4.sql`). */
const MAX_STEPS = 50;
const COACHING_TEXT_MAX = 200;
const COACHING_KEY_MAX = 160;
const COACHING_KEYS_MAX = 4;
const COACHING_BYTES_MAX = 4000;

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
  if (Array.isArray(draft.steps) && draft.steps.length > MAX_STEPS) return 'Demasiados pasos (máximo 50)';
  return validateCoaching(draft.coaching);
}

/** Characters of the trimmed text (code points, like Postgres `char_length`). */
function trimmedLength(value: string): number {
  return Array.from(value.trim()).length;
}

function isTextBetween(value: unknown, max: number): boolean {
  if (typeof value !== 'string') return false;
  const length = trimmedLength(value);
  return length >= 1 && length <= max;
}

function utf8Bytes(text: string): number {
  return Array.from(text).reduce((sum, ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return sum + (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);
  }, 0);
}

/** Stored size of the coaching (trimmed texts, known keys only), like the server's `pg_column_size` check. */
function coachingBytes(c: Record<string, unknown>, keys: readonly unknown[]): number {
  const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : null);
  return utf8Bytes(JSON.stringify({ objective: trimmed(c.objective), keys: keys.map(trimmed), success: trimmed(c.success), planB: trimmed(c.planB) }));
}

/** Stored form of a valid coaching, as the server keeps it: trimmed texts, keys default [], plan B default null. */
export function normalizeCoaching(c: WorkoutCoaching): WorkoutCoaching {
  return {
    objective: c.objective.trim(),
    keys: (c.keys ?? []).map((k) => k.trim()),
    success: c.success.trim(),
    planB: c.planB?.trim() || null,
  };
}

/**
 * First error (Spanish, the server's wording) of a workout's coaching, or
 * null when it is valid, absent (undefined) or cleared (null). Objective and
 * success 1–200 characters, 0–4 keys of 1–160, plan B null or 1–200.
 */
export function validateCoaching(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'Indicaciones del entreno no válidas';
  const c = value as Record<string, unknown>;
  if (!isTextBetween(c.objective, COACHING_TEXT_MAX)) return 'Objetivo del entreno no válido (1–200 caracteres)';
  const keys: readonly unknown[] = Array.isArray(c.keys) ? c.keys : [];
  if (keys.length > COACHING_KEYS_MAX) return 'Máximo 4 claves por entreno';
  const badKeysType = c.keys !== undefined && c.keys !== null && !Array.isArray(c.keys);
  if (badKeysType || keys.some((k) => !isTextBetween(k, COACHING_KEY_MAX))) {
    return 'Claves del entreno no válidas (1–160 caracteres cada una)';
  }
  if (!isTextBetween(c.success, COACHING_TEXT_MAX)) return 'Criterio de éxito no válido (1–200 caracteres)';
  if (c.planB !== undefined && c.planB !== null && !isTextBetween(c.planB, COACHING_TEXT_MAX)) {
    return 'Plan B no válido (1–200 caracteres)';
  }
  if (coachingBytes(c, keys) > COACHING_BYTES_MAX) return 'Indicaciones del entreno demasiado largas';
  return null;
}

function draftToWorkout(draft: WorkoutDraft, ctx: ApplyContext): Workout {
  return {
    // Objective, keys, success and plan B travel with the session (absent = none).
    ...(draft.coaching ? { coaching: normalizeCoaching(draft.coaching) } : {}),
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
  return { workouts: workouts.map((w) => (w.id === target.id ? patchedWorkout(target, change.patch, ctx) : w)), error: null };
}

/**
 * `target` with an update patch applied: undefined keeps a field, null clears
 * the nullable ones; `coaching: null` removes the coaching, steps are replaced
 * as given (targets, cues and brick legs included).
 */
function patchedWorkout(target: Workout, patch: Partial<WorkoutDraft>, ctx: ApplyContext): Workout {
  const { source, coaching, ...rest } = patch;
  const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<WorkoutDraft>;
  const base: Workout = {
    ...target,
    ...defined,
    title: rest.title?.trim() ?? target.title,
    source: source ?? target.source,
    updatedAt: ctx.now,
  };
  return withCoachingPatch(base, coaching);
}

/**
 * Applies the `coaching` of a patch: undefined keeps the current one, null
 * removes it (absent = none, like a null column), an object replaces it in
 * its stored form.
 */
export function withCoachingPatch(workout: Workout, coaching: WorkoutCoaching | null | undefined): Workout {
  if (coaching === undefined) return workout;
  const { coaching: _previous, ...rest } = workout;
  return coaching === null ? rest : { ...rest, coaching: normalizeCoaching(coaching) };
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
