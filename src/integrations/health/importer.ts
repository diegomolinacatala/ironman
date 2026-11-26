/**
 * Imports Apple Health workouts into the plan: completes the matching planned
 * workout (domain `matchActivity`) or creates a completed unplanned one. A
 * session the athlete already marked done by hand («Hecho») is not skipped as a
 * duplicate: it gets the activity's numbers (domain `enrichManualCompletion`),
 * keeping the athlete's RPE, sensaciones and notes.
 *
 * Depends only on a subset of the Repository, so it is testable with a fake.
 */
import { matchActivity } from '@/domain/matching';
import type { CompletedData, DateRange, ISODate, ISOTime, Sport, Workout, WorkoutDraft } from '@/domain/types';
import { enrichManualCompletion, isManualCompletion } from '@/domain/watchCompletion';
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
  /** Highest heart rate of the workout, ppm (HealthKit statistics). */
  maxHr?: number | null;
  /** `totalEnergyBurned` of the workout, kcal. */
  kcal?: number | null;
  /** App that wrote it to Apple Salud ("COROS", "Connect"…), when HealthKit tells. */
  sourceName?: string | null;
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
  maxHr: number | null;
  kcal: number | null;
  completedAt: string;
}

export type HealthRepo = Pick<Repository, 'listWorkouts' | 'createWorkout' | 'completeWorkout' | 'updateWorkout'>;

export interface ImportResult {
  workoutsCompleted: number;
  activitiesImported: number;
  /** Sessions marked done by hand that got the activity's numbers in this run. */
  workoutsEnriched: number;
  /** External ids handled in this run (imported, matched, enriched or recognised as duplicates). */
  handledIds: string[];
}

const DUPLICATE_MIN_TOLERANCE = 10;
const DUPLICATE_RATIO_TOLERANCE = 0.15;
const DUPLICATE_START_TOLERANCE_MIN = 45;
const MAX_HR = 240;
const MAX_KCAL = 20_000;

/** Rounded positive value up to `max`, else null. */
function positive(value: number | null | undefined, max: number): number | null {
  return value != null && Number.isFinite(value) && value > 0 && value <= max ? Math.round(value) : null;
}

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
    maxHr: positive(activity.maxHr, MAX_HR),
    kcal: positive(activity.kcal, MAX_KCAL),
    completedAt: activity.end.toISOString(),
  };
}

function sportsOverlap(a: Sport, b: Sport): boolean {
  if (a === b) return true;
  const multi = (s: Sport) => s === 'brick' || s === 'bike' || s === 'run';
  return (a === 'brick' || b === 'brick') && multi(a) && multi(b);
}

/** A completed workout on the same day, same sport, similar duration and start time as `candidate`. */
function sameActivityShape(candidate: ImportCandidate, w: Workout): boolean {
  if (w.status !== 'completed' || w.date !== candidate.date) return false;
  if (!sportsOverlap(w.sport, candidate.sport)) return false;
  const actual = w.completed?.durationMin ?? w.durationMin;
  const tolerance = Math.max(DUPLICATE_MIN_TOLERANCE, candidate.durationMin * DUPLICATE_RATIO_TOLERANCE);
  if (Math.abs(actual - candidate.durationMin) > tolerance) return false;
  const a = parseTimeMinutes(w.startTime);
  const b = parseTimeMinutes(candidate.startTime);
  return a == null || b == null || Math.abs(a - b) <= DUPLICATE_START_TOLERANCE_MIN;
}

/**
 * True when `candidate` is already in the plan: same external id, or a completed
 * workout imported from another source (e.g. synced from Garmin) on the same day,
 * same sport, similar duration and start time. Prevents Garmin → Health → Road to
 * Ironman double imports. A session marked done by hand is not a duplicate
 * (`findManualLookalike`), and a still-planned 'healthkit:<uuid>' row is an orphan to finish.
 */
export function isLikelyDuplicate(candidate: ImportCandidate, existing: readonly Workout[]): boolean {
  return existing.some((w) => {
    if (w.completed?.externalId === candidate.externalId) return true;
    if (w.externalId === healthExternalId(candidate.externalId)) return w.status !== 'planned';
    return !isManualCompletion(w) && sameActivityShape(candidate, w);
  });
}

/** The session the athlete marked done by hand that `candidate` records (same rules as a duplicate). */
export function findManualLookalike(candidate: ImportCandidate, existing: readonly Workout[]): Workout | undefined {
  return existing.find((w) => isManualCompletion(w) && sameActivityShape(candidate, w));
}

export function completedDataFor(candidate: ImportCandidate): CompletedData {
  return {
    source: 'healthkit',
    externalId: candidate.externalId,
    durationMin: candidate.durationMin,
    ...(candidate.distanceM != null ? { distanceM: candidate.distanceM } : {}),
    ...(candidate.avgHr != null ? { avgHr: candidate.avgHr } : {}),
    ...(candidate.maxHr != null ? { maxHr: candidate.maxHr } : {}),
    ...(candidate.kcal != null ? { kcal: candidate.kcal } : {}),
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

type Counter = 'workoutsCompleted' | 'activitiesImported' | 'workoutsEnriched';

function recordDone(state: ImportState, done: Workout, candidate: ImportCandidate, counter: Counter): ImportState {
  const r = state.result;
  return {
    planned: state.planned.filter((w) => w.id !== done.id),
    known: [...state.known.filter((w) => w.id !== done.id), done],
    result: { ...r, [counter]: r[counter] + 1, handledIds: [...r.handledIds, candidate.externalId] },
  };
}

async function importOne(repo: HealthRepo, candidate: ImportCandidate, state: ImportState): Promise<ImportState> {
  const data = completedDataFor(candidate);
  const manual = findManualLookalike(candidate, state.known);
  if (manual) {
    // «Hecho» by hand: the activity's numbers complete it (RPE, feel and notes stay).
    const enriched = await repo.updateWorkout(manual.id, { completed: enrichManualCompletion(manual.completed, data) });
    return recordDone(state, enriched, candidate, 'workoutsEnriched');
  }
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
    result: { workoutsCompleted: 0, activitiesImported: 0, workoutsEnriched: 0, handledIds: [] },
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
