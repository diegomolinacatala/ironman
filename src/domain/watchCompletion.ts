/**
 * A session marked done by hand («Hecho») and the same activity arriving later
 * from the watch (Garmin sync, Apple Salud, the athlete's Claude with the Garmin
 * or COROS connector). Before, the activity was dropped as a duplicate and its
 * real heart rate, load and distance were lost; now its objective numbers
 * complete the manual entry:
 *
 * - duration, distance, average and max HR, load, kcal, power and the activity
 *   id come from the watch (only the values it has);
 * - the athlete's RPE, sensaciones and notes are never overwritten (the watch
 *   data only fills them when the athlete left them empty);
 * - idempotent: once the activity id is stored, the workout is linked and the
 *   next sync treats the activity as already imported.
 *
 * Shared by the HealthKit importer (app) and the edge functions (Garmin sync,
 * MCP `log_completed_activity`) through scripts/sync-domain-mirror.mjs. Pure.
 */
import type { CompletedData, Workout } from './types';

/** Row-level ids of imported activities. 'claude:<uuid>' is a Claude log without an activity id. */
const ACTIVITY_ROW_PREFIXES: readonly string[] = ['garmin:', 'coros:', 'healthkit:'];

/** Sources that only ever write data read from a watch or Apple Salud. */
const WATCH_SOURCES: readonly string[] = ['garmin', 'healthkit'];

/** The watch's objective numbers (each replaces the hand-typed value when the watch has it). */
const OBJECTIVE_KEYS = [
  'durationMin',
  'distanceM',
  'avgHr',
  'maxHr',
  'tss',
  'kcal',
  'avgPowerW',
  'bestPower1MinW',
  'bestPower20MinW',
] as const;

/** What the athlete says about the session: kept as typed, filled only when empty. */
const ATHLETE_KEYS = ['rpe', 'feel', 'notes'] as const;

type CompletionLike = Pick<Workout, 'status' | 'completed' | 'externalId'>;

/**
 * Completed with no watch or Apple Salud activity linked yet: marked done by
 * hand («Hecho») or logged by Claude without an activity id.
 */
export function isManualCompletion(w: CompletionLike): boolean {
  if (w.status !== 'completed') return false;
  const c = w.completed;
  if (c?.externalId) return false;
  if (c?.source && WATCH_SOURCES.includes(c.source)) return false;
  const rowId = w.externalId ?? '';
  return !ACTIVITY_ROW_PREFIXES.some((prefix) => rowId.startsWith(prefix));
}

function defined<T extends object>(data: T, keys: readonly (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.filter((k) => data[k] !== undefined && data[k] !== null).map((k) => [k, data[k]])) as Partial<T>;
}

/**
 * `manual` (the athlete's «Hecho») completed with the watch's `activity`: its
 * numbers, source and id; the athlete's RPE, feel and notes; the original
 * completion time.
 */
export function enrichManualCompletion<C extends CompletedData>(manual: C | null | undefined, activity: C): C {
  const base = (manual ?? {}) as C;
  const athlete = Object.fromEntries(
    ATHLETE_KEYS.map((k) => [k, base[k] ?? activity[k]] as const).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<C>;
  const completedAt = base.completedAt ?? activity.completedAt;
  return {
    ...base,
    ...defined(activity, OBJECTIVE_KEYS as readonly (keyof C)[]),
    ...athlete,
    ...(activity.source ? { source: activity.source } : {}),
    ...(activity.externalId ? { externalId: activity.externalId } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}
