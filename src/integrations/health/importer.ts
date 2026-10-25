/**
 * Imports Apple Health workouts into the plan: completes the matching planned
 * workout (domain `matchActivity`) or creates a completed unplanned one.
 *
 * Depends only on a subset of the Repository, so it is testable with a fake.
 */
import { matchActivity } from '@/domain/matching';
import type { CompletedData, DateRange, ISODate, ISOTime, Sport, Workout, WorkoutDraft } from '@/domain/types';
import type { Repository } from '@/data/repository';
import { logger } from '@/lib/logger';

import { localDate, localTime, parseTimeMinutes } from '../time';
import { mapHealthActivity, MAX_ACTIVITY_MINUTES, MIN_ACTIVITY_MINUTES } from './mapping';

/** Workout read from HealthKit, already normalised to plain values. */
export interface HealthActivity {
  uuid: string;
  /** HKWorkoutActivityType raw value. */
  activityType: number;
  start: Date;
  end: Date;
  durationMin: number;
  distanceM: number | null;
  avgHr: number | null;
}

export interface ImportCandidate {
  externalId: string;
  date: ISODate;
  startTime: ISOTime;
  sport: Sport;
  title: string;
  durationMin: number;
  distanceM: number | null;
  avgHr: number | null;
  completedAt: string;
}

export type HealthRepo = Pick<Repository, 'listWorkouts' | 'createWorkout' | 'completeWorkout'>;

export interface ImportResult {
  workoutsCompleted: number;
  activitiesImported: number;
  /** External ids handled in this run (imported, matched or recognised as duplicates). */
  handledIds: string[];
}

const DUPLICATE_MIN_TOLERANCE = 10;
const DUPLICATE_RATIO_TOLERANCE = 0.15;
const DUPLICATE_START_TOLERANCE_MIN = 45;

/** Normalises an activity; null when it should not be imported (walks, transitions, too short). */
export function toImportCandidate(activity: HealthActivity): ImportCandidate | null {
  const kind = mapHealthActivity(activity.activityType);
  if (!kind) return null;
  if (!Number.isFinite(activity.durationMin) || activity.durationMin < MIN_ACTIVITY_MINUTES) return null;
  return {
    externalId: activity.uuid,
    date: localDate(activity.start),
    startTime: localTime(activity.start),
    sport: kind.sport,
    title: kind.title,
    durationMin: Math.min(MAX_ACTIVITY_MINUTES, Math.round(activity.durationMin)),
    distanceM: activity.distanceM != null && activity.distanceM > 0 ? Math.round(activity.distanceM) : null,
    avgHr: activity.avgHr != null && activity.avgHr > 0 ? Math.round(activity.avgHr) : null,
    completedAt: activity.end.toISOString(),
  };
}

function sportsOverlap(a: Sport, b: Sport): boolean {
  if (a === b) return true;
  const multi = (s: Sport) => s === 'brick' || s === 'bike' || s === 'run';
  return (a === 'brick' || b === 'brick') && multi(a) && multi(b);
}

/**
 * True when `candidate` is already in the plan: same external id, or a completed
 * workout (e.g. synced from Garmin) on the same day, same sport, similar duration
 * and start time. Prevents Garmin → Health → Rebufo double imports.
 * A still-planned 'healthkit:<uuid>' row is NOT a duplicate but an orphan to finish.
 */
export function isLikelyDuplicate(candidate: ImportCandidate, existing: readonly Workout[]): boolean {
  return existing.some((w) => {
    if (w.completed?.externalId === candidate.externalId) return true;
    if (w.externalId === healthExternalId(candidate.externalId)) return w.status !== 'planned';
    if (w.status !== 'completed' || w.date !== candidate.date) return false;
    if (!sportsOverlap(w.sport, candidate.sport)) return false;
    const actual = w.completed?.durationMin ?? w.durationMin;
    const tolerance = Math.max(DUPLICATE_MIN_TOLERANCE, candidate.durationMin * DUPLICATE_RATIO_TOLERANCE);
    if (Math.abs(actual - candidate.durationMin) > tolerance) return false;
    const a = parseTimeMinutes(w.startTime);
    const b = parseTimeMinutes(candidate.startTime);
    return a == null || b == null || Math.abs(a - b) <= DUPLICATE_START_TOLERANCE_MIN;
  });
}

export function completedDataFor(candidate: ImportCandidate): CompletedData {
  return {
    source: 'healthkit',
    externalId: candidate.externalId,
    durationMin: candidate.durationMin,
    ...(candidate.distanceM != null ? { distanceM: candidate.distanceM } : {}),
    ...(candidate.avgHr != null ? { avgHr: candidate.avgHr } : {}),
    completedAt: candidate.completedAt,
  };
}

export function unplannedDraftFor(candidate: ImportCandidate): WorkoutDraft {
  return {
    date: candidate.date,
    startTime: candidate.startTime,
    sport: candidate.sport,
    title: candidate.title,
    description: 'Importado de Apple Salud',
    durationMin: candidate.durationMin,
    distanceM: candidate.distanceM,
    intensity: 'endurance',
    source: 'healthkit',
    externalId: healthExternalId(candidate.externalId),
  };
}

const HEALTH_EXTERNAL_PREFIX = 'healthkit:';

/** Workout-level dedupe key for HealthKit imports (matches the DB unique index on external_id). */
export function healthExternalId(uuid: string): string {
  return `${HEALTH_EXTERNAL_PREFIX}${uuid}`;
}

function isHealthImport(w: Workout): boolean {
  return w.externalId?.startsWith(HEALTH_EXTERNAL_PREFIX) ?? false;
}

/**
 * An unplanned import whose completion never landed: `createWorkout` inserted it
 * as planned and `completeWorkout` failed (network drop). It is finished, not skipped.
 */
export function findOrphanImport(candidate: ImportCandidate, existing: readonly Workout[]): Workout | undefined {
  return existing.find((w) => w.status === 'planned' && w.externalId === healthExternalId(candidate.externalId));
}

interface ImportState {
  planned: readonly Workout[];
  known: readonly Workout[];
  result: ImportResult;
}

type Counter = 'workoutsCompleted' | 'activitiesImported';

function recordDone(state: ImportState, done: Workout, candidate: ImportCandidate, counter: Counter): ImportState {
  const r = state.result;
  const counted =
    counter === 'workoutsCompleted'
      ? { ...r, workoutsCompleted: r.workoutsCompleted + 1 }
      : { ...r, activitiesImported: r.activitiesImported + 1 };
  return {
    planned: state.planned.filter((w) => w.id !== done.id),
    known: [...state.known.filter((w) => w.id !== done.id), done],
    result: { ...counted, handledIds: [...r.handledIds, candidate.externalId] },
  };
}

async function importOne(repo: HealthRepo, candidate: ImportCandidate, state: ImportState): Promise<ImportState> {
  const data = completedDataFor(candidate);
  const orphan = findOrphanImport(candidate, state.known);
  if (orphan) return recordDone(state, await repo.completeWorkout(orphan.id, data), candidate, 'activitiesImported');

  const match = matchActivity(
    { date: candidate.date, sport: candidate.sport, durationMin: candidate.durationMin, startTime: candidate.startTime },
    [...state.planned],
  );
  if (match) return recordDone(state, await repo.completeWorkout(match.id, data), candidate, 'workoutsCompleted');

  const created = await repo.createWorkout(unplannedDraftFor(candidate));
  // If this throws, the planned 'healthkit:<uuid>' row is picked up as an orphan on the next sync.
  const done = await repo.completeWorkout(created.id, data);
  return recordDone(state, done, candidate, 'activitiesImported');
}

/**
 * Applies candidates in chronological order. Failures are logged per activity
 * and left out of `handledIds` so they are retried on the next sync.
 */
export async function importActivities(
  repo: HealthRepo,
  candidates: readonly ImportCandidate[],
  ctx: { range: DateRange; knownIds: ReadonlySet<string> },
): Promise<ImportResult> {
  const existing = await repo.listWorkouts(ctx.range);
  let state: ImportState = {
    // Orphaned imports are never offered to `matchActivity` for another activity.
    planned: existing.filter((w) => w.status === 'planned' && w.sport !== 'rest' && !isHealthImport(w)),
    known: existing,
    result: { workoutsCompleted: 0, activitiesImported: 0, handledIds: [] },
  };
  const ordered = [...candidates].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  for (const candidate of ordered) {
    if (ctx.knownIds.has(candidate.externalId)) continue;
    if (isLikelyDuplicate(candidate, state.known)) {
      state = { ...state, result: { ...state.result, handledIds: [...state.result.handledIds, candidate.externalId] } };
      continue;
    }
    try {
      state = await importOne(repo, candidate, state);
    } catch (error) {
      logger.warn('healthkit: failed to import activity', error);
    }
  }
  return state.result;
}
