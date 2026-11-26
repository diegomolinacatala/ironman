/**
 * "Planificar semana" with the weather (pure, app only): the rules planner's
 * proposal is played on a copy of the week, the weather layer (`weatherPlan.ts`)
 * runs on that copy, and its changes are folded back into ONE proposal — a new
 * session that falls in the rain is added directly on its dry day, at its dry
 * time or indoors (its reason says why); an existing session gets its own
 * move/update. The planner itself is untouched.
 */
import { applyPlanChanges } from './changes';
import type { PlanChange, Workout, WorkoutDraft } from './types';
import { planForWeather, type WeatherPlanInput } from './weatherPlan';

const PLANNED = 'planned:';

export interface PlannedWeekInput extends Omit<WeatherPlanInput, 'weekWorkouts' | 'scope'> {
  /** The week's workouts before the plan (and the days around it, for hard-day checks). */
  existing: Workout[];
  /** The planner's changes. */
  planned: PlanChange[];
  userId: string;
}

export interface PlannedWeekResult {
  changes: PlanChange[];
  /** Sentence for the proposal summary ("" when the weather changed nothing). */
  note: string;
  signature: string;
}

/** The week as it would be with the plan applied; added sessions get the id `planned:<index of the change>`. */
function simulate(existing: readonly Workout[], planned: readonly PlanChange[], userId: string): Workout[] {
  return planned.reduce<Workout[]>(
    (week, change, index) => applyPlanChanges(week, [change], { userId, now: '1970-01-01T00:00:00', newId: () => `${PLANNED}${index}` }).workouts,
    [...existing],
  );
}

function definedOnly(patch: Partial<WorkoutDraft>): Partial<WorkoutDraft> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<WorkoutDraft>;
}

function foldDraft(draft: WorkoutDraft, change: PlanChange): WorkoutDraft {
  if (change.op === 'move') return { ...draft, date: change.toDate, startTime: change.toStartTime === undefined ? draft.startTime : change.toStartTime };
  if (change.op === 'update') return { ...draft, ...definedOnly(change.patch) };
  return draft;
}

/** The planner's changes with the weather folded in. */
export function weatherAdjustPlan(input: PlannedWeekInput): PlannedWeekResult {
  const { existing, planned, userId, ...rest } = input;
  const weather = planForWeather({ ...rest, weekWorkouts: simulate(existing, planned, userId), scope: 'week' });
  if (weather.changes.length === 0) return { changes: [...planned], note: '', signature: '' };
  const changes = [...planned];
  const extra: PlanChange[] = [];
  for (const change of weather.changes) {
    const id = change.op === 'add' ? null : change.workoutId;
    const target = id?.startsWith(PLANNED) ? changes[Number(id.slice(PLANNED.length))] : undefined;
    if (id?.startsWith(PLANNED) && target?.op === 'add') {
      const index = Number(id.slice(PLANNED.length));
      changes[index] = { ...target, workout: foldDraft(target.workout, change), reason: `${target.reason.replace(/\.?$/, '.')} ${change.reason}` };
    } else if (!id?.startsWith(PLANNED)) {
      extra.push(change);
    }
  }
  return { changes: [...changes, ...extra], note: weather.summary, signature: weather.signature };
}
