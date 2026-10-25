import type {
  ApplyResult,
  CompletedData,
  DateRange,
  PlanChange,
  UUID,
  Workout,
  WorkoutDraft,
  WorkoutPatch,
} from '@/domain/types';

import type { Repository } from '../repository';
import { assertWorkoutDraft } from '../demo/validation';
import {
  RESET_PATCH,
  changeDates,
  changeWorkoutIds,
  completionPatch,
  rangeOf,
  skipPatch,
} from '../demo/workoutOps';
import { run, runOne, runVoid, type SupabaseCtx } from './base';
import { rowToWorkout, workoutDraftToInsert, workoutPatchToUpdate } from './mappers';
import { asArray, asNumber, asString, isRecord } from './narrow';
import type { WorkoutRow } from './rows';

type WorkoutMethods = Pick<
  Repository,
  | 'listWorkouts'
  | 'getWorkout'
  | 'createWorkout'
  | 'updateWorkout'
  | 'deleteWorkout'
  | 'completeWorkout'
  | 'skipWorkout'
  | 'resetWorkout'
  | 'applyPlanChanges'
>;

const NOT_FOUND = 'Ese entreno ya no existe.';

function byDateTime(a: Workout, b: Workout): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
}

/** `apply_plan_changes` → `{ applied, failed: [{ index, error }] }`. */
export function parseApplyRpc(value: unknown): Omit<ApplyResult, 'workouts'> {
  const record = isRecord(value) ? value : {};
  const failed = asArray(record.failed)
    .filter(isRecord)
    .map((f) => ({ index: asNumber(f.index) ?? -1, error: asString(f.error) ?? 'Cambio no aplicado' }));
  return { applied: asNumber(record.applied) ?? 0, failed };
}

export function workoutsApi(ctx: SupabaseCtx): WorkoutMethods {
  const { client } = ctx;

  async function listWorkouts(range: DateRange): Promise<Workout[]> {
    const me = await ctx.userId();
    const rows = await run<WorkoutRow[] | null>(
      'listWorkouts',
      client
        .from('workouts')
        .select('*')
        .eq('user_id', me)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false }),
    );
    return (rows ?? []).map(rowToWorkout);
  }

  async function getWorkout(id: UUID): Promise<Workout | null> {
    const row = await run<WorkoutRow | null>('getWorkout', client.from('workouts').select('*').eq('id', id).maybeSingle());
    return row ? rowToWorkout(row) : null;
  }

  async function createWorkout(draft: WorkoutDraft): Promise<Workout> {
    assertWorkoutDraft(draft, false);
    const me = await ctx.userId();
    const row = await runOne<WorkoutRow>(
      'createWorkout',
      client.from('workouts').insert(workoutDraftToInsert(draft, me)).select('*').single(),
      NOT_FOUND,
    );
    return rowToWorkout(row);
  }

  async function updateWorkout(id: UUID, patch: WorkoutPatch): Promise<Workout> {
    assertWorkoutDraft(patch, true);
    const values = { ...workoutPatchToUpdate(patch), updated_at: ctx.now() };
    const row = await runOne<WorkoutRow>(
      'updateWorkout',
      client.from('workouts').update(values).eq('id', id).select('*').maybeSingle(),
      NOT_FOUND,
    );
    return rowToWorkout(row);
  }

  async function deleteWorkout(id: UUID): Promise<void> {
    await runVoid('deleteWorkout', client.from('workouts').delete().eq('id', id));
  }

  const completeWorkout = (id: UUID, data: CompletedData): Promise<Workout> =>
    updateWorkout(id, completionPatch(data, ctx.now()));
  const skipWorkout = (id: UUID, reason?: string): Promise<Workout> => updateWorkout(id, skipPatch(reason));
  const resetWorkout = (id: UUID): Promise<Workout> => updateWorkout(id, RESET_PATCH);

  async function affectedWorkouts(changes: readonly PlanChange[]): Promise<Workout[]> {
    const range = rangeOf(changeDates(changes));
    const ids = changeWorkoutIds(changes);
    const [inRange, byId] = await Promise.all([
      range ? listWorkouts(range) : Promise.resolve<Workout[]>([]),
      ids.length > 0
        ? run<WorkoutRow[] | null>('affectedWorkouts', client.from('workouts').select('*').in('id', ids)).then((rows) =>
            (rows ?? []).map(rowToWorkout),
          )
        : Promise.resolve<Workout[]>([]),
    ]);
    const merged = new Map([...inRange, ...byId].map((w) => [w.id, w]));
    return [...merged.values()].sort(byDateTime);
  }

  async function applyPlanChanges(changes: PlanChange[], proposalId?: UUID): Promise<ApplyResult> {
    const result = await run<unknown>(
      'applyPlanChanges',
      client.rpc('apply_plan_changes', { p_changes: changes, p_proposal_id: proposalId ?? null }),
      'No se han podido aplicar los cambios.',
    );
    const parsed = parseApplyRpc(result);
    const workouts = await affectedWorkouts(changes);
    return { ...parsed, workouts };
  }

  return {
    listWorkouts,
    getWorkout,
    createWorkout,
    updateWorkout,
    deleteWorkout,
    completeWorkout,
    skipWorkout,
    resetWorkout,
    applyPlanChanges,
  };
}
