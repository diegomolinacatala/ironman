/**
 * Matches an imported activity (Garmin / HealthKit) to a planned workout:
 * same day, compatible sport (brick ↔ bike/run), duration within 50-150 %,
 * closest start time.
 */
import { timeToMinutes } from './dates';
import type { ISODate, ISOTime, Sport, Workout } from './types';

export interface ActivityToMatch {
  date: ISODate;
  sport: Sport;
  durationMin: number;
  startTime?: ISOTime | null;
}

const MIN_RATIO = 0.5;
const MAX_RATIO = 1.5;

/** 0 = same sport, 1 = compatible (brick ↔ bike/run), null = incompatible. */
function sportDistance(activity: Sport, planned: Sport): number | null {
  if (activity === planned) return 0;
  const brickPair = (activity === 'brick' && (planned === 'bike' || planned === 'run')) || (planned === 'brick' && (activity === 'bike' || activity === 'run'));
  return brickPair ? 1 : null;
}

function startGap(a: ISOTime | null | undefined, b: ISOTime | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const gap = Math.abs(timeToMinutes(a) - timeToMinutes(b));
  return Number.isFinite(gap) ? gap : Number.POSITIVE_INFINITY;
}

export function matchActivity(activity: ActivityToMatch, planned: Workout[]): Workout | null {
  const candidates = planned
    .filter((w) => w.status === 'planned' && w.date === activity.date && w.durationMin > 0)
    .map((w) => ({ w, sport: sportDistance(activity.sport, w.sport), ratio: activity.durationMin / w.durationMin }))
    .filter((c): c is { w: Workout; sport: number; ratio: number } => c.sport !== null && c.ratio >= MIN_RATIO && c.ratio <= MAX_RATIO);
  const sorted = [...candidates].sort(
    (a, b) =>
      a.sport - b.sport ||
      startGap(activity.startTime, a.w.startTime) - startGap(activity.startTime, b.w.startTime) ||
      Math.abs(1 - a.ratio) - Math.abs(1 - b.ratio) ||
      a.w.id.localeCompare(b.w.id),
  );
  return sorted[0]?.w ?? null;
}
