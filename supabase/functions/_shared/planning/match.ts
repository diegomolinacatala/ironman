/**
 * Matching of an executed activity (Garmin / Claude bridge) to a planned
 * workout: same day, compatible sport (brick ↔ bike/run), duration within
 * 50–150 % of the plan, closest start time (then closest duration).
 *
 * Plus duplicate detection: the same activity often reaches the app twice
 * (Garmin Connect → Apple Health → app, and Garmin Personal API / Claude
 * bridge → server). `findCompletedLookalike` spots a workout that is already
 * completed with the same activity, so it is not imported a second time.
 * Same rules as the app's HealthKit importer (src/integrations/health/importer.ts).
 */
import { timeToMinutes } from '../dates.ts';
import type { ISODate, ISOTime, Sport, UUID, Workout } from '../types.ts';

export interface ActivityLike {
  date: ISODate;
  sport: Sport;
  durationMin: number;
  startTime?: ISOTime | null;
}

export function compatibleSport(planned: Sport, actual: Sport): boolean {
  if (planned === actual) return planned !== 'rest';
  if (planned === 'brick') return actual === 'bike' || actual === 'run';
  if (actual === 'brick') return planned === 'bike' || planned === 'run';
  return false;
}

function score(activity: ActivityLike, w: Workout): number {
  const timePenalty =
    activity.startTime && w.startTime ? Math.abs(timeToMinutes(activity.startTime) - timeToMinutes(w.startTime)) : 600;
  const durationPenalty = Math.abs(activity.durationMin / w.durationMin - 1) * 100;
  return timePenalty + durationPenalty;
}

export function matchActivity(
  activity: ActivityLike,
  planned: readonly Workout[],
  excluded: ReadonlySet<UUID> = new Set(),
): Workout | null {
  const candidates = planned.filter((w) => {
    if (w.status !== 'planned' || w.date !== activity.date || excluded.has(w.id)) return false;
    if (!compatibleSport(w.sport, activity.sport) || w.durationMin <= 0) return false;
    const ratio = activity.durationMin / w.durationMin;
    return ratio >= 0.5 && ratio <= 1.5;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, w) => (score(activity, w) < score(activity, best) ? w : best));
}

/** Duration tolerance of a duplicate: max(10 min, 15 %). Start times within 45 min (or unknown). */
export const DUPLICATE_MIN_TOLERANCE = 10;
export const DUPLICATE_RATIO_TOLERANCE = 0.15;
export const DUPLICATE_START_TOLERANCE_MIN = 45;

/** Garmin activity id a workout is linked to (`external_id 'garmin:<id>'` or a Garmin/Claude completion), if any. */
export function garminIdOf(w: Workout): string | null {
  if (w.externalId?.startsWith('garmin:')) return w.externalId.slice('garmin:'.length);
  const c = w.completed;
  if (c?.externalId && (c.source === 'garmin' || c.source === 'claude')) return c.externalId;
  return null;
}

/**
 * A completed workout that already records `activity` (e.g. imported from
 * Apple Health): same day, overlapping sport, similar duration and start.
 * With `garminId`, workouts linked to a *different* Garmin activity are not
 * duplicates (two real sessions with the same shape).
 */
export function findCompletedLookalike(activity: ActivityLike, workouts: readonly Workout[], opts: { garminId?: string | null } = {}): Workout | null {
  const tolerance = Math.max(DUPLICATE_MIN_TOLERANCE, activity.durationMin * DUPLICATE_RATIO_TOLERANCE);
  return (
    workouts.find((w) => {
      if (w.status !== 'completed' || w.date !== activity.date || !compatibleSport(w.sport, activity.sport)) return false;
      const linked = garminIdOf(w);
      if (opts.garminId && linked && linked !== opts.garminId) return false;
      const actual = w.completed?.durationMin ?? w.durationMin;
      if (Math.abs(actual - activity.durationMin) > tolerance) return false;
      if (!activity.startTime || !w.startTime) return true;
      return Math.abs(timeToMinutes(activity.startTime) - timeToMinutes(w.startTime)) <= DUPLICATE_START_TOLERANCE_MIN;
    }) ?? null
  );
}
