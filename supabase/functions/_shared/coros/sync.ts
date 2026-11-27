/**
 * COROS sync through the official COROS MCP (last 14 days; 28 after connecting):
 * wellness reports → daily_metrics (source 'coros', merged per field), activities →
 * complete matching planned workouts or insert completed unplanned ones with external_id
 * 'coros:<labelId>' (the same key the Claude connector's log_completed_activity uses, so an
 * activity Claude already logged is never imported twice).
 */
import { addDays, todayIn } from '../dates.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { sportLabel } from '../planning/labels.ts';
import { findCompletedLookalike, matchActivity } from '../planning/match.ts';
import type { CompletedWorkoutInsert, MetricsUpsert, PlanningStore } from '../planning/store.ts';
import type { CompletedData, Intensity, SyncResult, UUID, Workout } from '../types.ts';
import { timeToMinutes } from '../dates.ts';
import { CorosApiError } from './mcp.ts';
import type { CorosMcp } from './mcp.ts';
import {
  mergeDays,
  parseActivityDetail,
  parseDailyHealth,
  parseRecovery,
  parseRestingHr,
  parseSleepHrv,
  parseSleepOverview,
  parseSportRecords,
  parseTrainingLoad,
  parseVo2max,
  yyyymmdd,
} from './parse.ts';
import type { CorosActivity, DayPart } from './parse.ts';

export const SYNC_DAYS = 14;
export const FIRST_SYNC_DAYS = 28;
const MAX_SYNC_DAYS = 28;
/** getActivityDetail calls per sync (training load + focus of the new activities only). */
export const MAX_DETAIL_CALLS = 30;
/** Apple Salud gets the elapsed time from COROS: same day, sport and start (± this) is the same session. */
const HEALTH_TWIN_START_TOLERANCE_MIN = 15;

export type CorosSyncStore = Pick<PlanningStore, 'listWorkouts' | 'completeWorkout' | 'insertCompletedWorkout' | 'upsertMetrics'>;

export interface CorosSyncDeps {
  store: CorosSyncStore;
  now: () => Date;
  logger: Logger;
}

export const externalIdOf = (labelId: string): string => `coros:${labelId}`;

/** COROS "Training Focus" → app intensity (COROS load is not on the TSS scale, so it is not used for this). */
export function intensityFromFocus(focus: string | null): Intensity {
  const f = (focus ?? '').toLowerCase();
  if (f.includes('recovery')) return 'recovery';
  if (f.includes('threshold')) return 'threshold';
  if (f.includes('tempo')) return 'tempo';
  if (f.includes('vo2') || f.includes('anaerobic') || f.includes('sprint')) return 'vo2';
  return 'endurance';
}

function completedFor(a: CorosActivity, nowIso: string): CompletedData {
  return {
    source: 'coros',
    externalId: externalIdOf(a.id),
    durationMin: a.durationMin,
    ...(a.distanceM !== null ? { distanceM: a.distanceM } : {}),
    ...(a.avgHr !== null ? { avgHr: a.avgHr } : {}),
    ...(a.tss !== null ? { tss: a.tss } : {}),
    completedAt: nowIso,
  };
}

/** A completed Apple Salud import of the same session (its duration is the elapsed time, so only the start is compared). */
export function healthTwin(a: CorosActivity, workouts: readonly Workout[]): Workout | null {
  if (!a.startTime) return null;
  const start = timeToMinutes(a.startTime);
  return (
    workouts.find(
      (w) =>
        w.status === 'completed' &&
        w.completed?.source === 'healthkit' &&
        w.date === a.date &&
        w.sport === a.sport &&
        w.startTime !== null &&
        Math.abs(timeToMinutes(w.startTime) - start) <= HEALTH_TWIN_START_TOLERANCE_MIN,
    ) ?? null
  );
}

export interface ImportPlan {
  completions: { workoutId: UUID; completed: CompletedData }[];
  inserts: CompletedWorkoutInsert[];
  skipped: number;
}

/** Pure: what to do with each activity given the user's workouts in the window. */
export function planActivityImport(
  activities: readonly CorosActivity[],
  workouts: readonly Workout[],
  nowIso: string,
  focusById: ReadonlyMap<string, string | null> = new Map(),
): ImportPlan {
  const known = new Set<string>();
  for (const w of workouts) {
    if (w.externalId) known.add(w.externalId);
    if (w.completed?.externalId) known.add(w.completed.externalId);
  }
  const used = new Set<UUID>();
  const plan: ImportPlan = { completions: [], inserts: [], skipped: 0 };
  const ordered = [...activities].sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  for (const a of ordered) {
    const key = externalIdOf(a.id);
    if (known.has(key) || findCompletedLookalike(a, workouts) || healthTwin(a, workouts)) {
      plan.skipped += 1;
      continue;
    }
    known.add(key);
    const completed = completedFor(a, nowIso);
    const match = matchActivity(a, workouts, used);
    if (match) {
      used.add(match.id);
      plan.completions.push({ workoutId: match.id, completed });
      continue;
    }
    plan.inserts.push({
      date: a.date,
      startTime: a.startTime,
      sport: a.sport,
      title: a.name ?? sportLabel(a.sport),
      durationMin: a.durationMin,
      distanceM: a.distanceM,
      intensity: intensityFromFocus(focusById.get(a.id) ?? null),
      completed,
      source: 'coros',
      externalId: key,
    });
  }
  return plan;
}

export function toMetricRows(parts: readonly DayPart[], nowIso: string): MetricsUpsert[] {
  return parts.map((p) => ({ ...p, raw: { source: 'COROS', via: 'coros_mcp', syncedAt: nowIso } }));
}

/** Calls a tool; a failing wellness report is logged and skipped, an auth failure aborts the sync. */
async function tryTool(mcp: CorosMcp, logger: Logger, name: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    return await mcp.callTool(name, args);
  } catch (error) {
    if (error instanceof CorosApiError && (error.status === 401 || error.status === 403)) throw error;
    logger.warn('coros tool failed', { tool: name, ...errorInfo(error) });
    return null;
  }
}

async function fetchWellness(mcp: CorosMcp, logger: Logger, from: string, to: string, days: number, tz: string): Promise<DayPart[]> {
  const range = { startDate: yyyymmdd(from), endDate: yyyymmdd(to) };
  const [daily, sleep, hrv, resting, load, recovery, fitness] = await Promise.all([
    tryTool(mcp, logger, 'queryDailyHealthData', { days }),
    tryTool(mcp, logger, 'querySleepOverview', range),
    tryTool(mcp, logger, 'querySleepHrv', range),
    tryTool(mcp, logger, 'queryRestingHeartRate', { days }),
    tryTool(mcp, logger, 'queryTrainingLoadAssessment', { days }),
    tryTool(mcp, logger, 'queryRecoveryStatus', { days: 1 }),
    tryTool(mcp, logger, 'queryFitnessAssessmentOverview', { days: 1 }),
  ]);
  const parts: DayPart[] = [
    ...(daily ? parseDailyHealth(daily) : []),
    ...(sleep ? parseSleepOverview(sleep, tz) : []),
    ...(hrv ? parseSleepHrv(hrv) : []),
    ...(resting ? parseRestingHr(resting) : []),
    ...(load ? parseTrainingLoad(load) : []),
  ];
  const readiness = recovery ? parseRecovery(recovery) : null;
  const vo2max = fitness ? parseVo2max(fitness) : null;
  if (readiness !== null || vo2max !== null) {
    parts.push({ date: to, ...(readiness !== null ? { trainingReadiness: readiness } : {}), ...(vo2max !== null ? { vo2max } : {}) });
  }
  return parts;
}

/** Training load + focus of activities not in the plan yet (bounded number of calls). */
async function fetchDetails(mcp: CorosMcp, logger: Logger, activities: CorosActivity[], known: ReadonlySet<string>): Promise<Map<string, string | null>> {
  const focus = new Map<string, string | null>();
  const pending = activities.filter((a) => !known.has(externalIdOf(a.id))).slice(-MAX_DETAIL_CALLS);
  for (const a of pending) {
    const text = await tryTool(mcp, logger, 'getActivityDetail', { labelId: a.id, sportType: a.sportType });
    if (!text) continue;
    const detail = parseActivityDetail(text);
    if (detail.trainingLoad !== null) a.tss = detail.trainingLoad;
    focus.set(a.id, detail.trainingFocus);
  }
  return focus;
}

async function applyImport(deps: CorosSyncDeps, userId: UUID, plan: ImportPlan): Promise<{ completed: number; inserted: number }> {
  let completed = 0;
  let inserted = 0;
  for (const c of plan.completions) {
    if (await deps.store.completeWorkout(userId, c.workoutId, c.completed)) completed += 1;
  }
  for (const row of plan.inserts) {
    if (await deps.store.insertCompletedWorkout(userId, row)) inserted += 1;
  }
  return { completed, inserted };
}

export interface SyncUserInput {
  userId: UUID;
  timezone: string;
  /** Days back from today, inclusive (default SYNC_DAYS, max 28). */
  days?: number;
}

/** Syncs one user. Throws CorosApiError(401/403) when COROS no longer accepts the token. */
export async function syncCorosUser(deps: CorosSyncDeps, mcp: CorosMcp, input: SyncUserInput): Promise<SyncResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const days = Math.max(1, Math.min(MAX_SYNC_DAYS, Math.round(input.days ?? SYNC_DAYS)));
  const to = todayIn(input.timezone, now);
  const from = addDays(to, -(days - 1));

  // The activity list is the one call that must work: without it COROS is not answering.
  const recordsText = await mcp.callTool('querySportRecords', { startDate: yyyymmdd(from), endDate: yyyymmdd(to), limit: 100 });
  const activities = parseSportRecords(recordsText, input.timezone).filter((a) => a.date >= from && a.date <= to);
  const workouts = await deps.store.listWorkouts(input.userId, from, to);
  const known = new Set<string>(workouts.flatMap((w) => [w.externalId, w.completed?.externalId].filter((x): x is string => !!x)));
  const focus = await fetchDetails(mcp, deps.logger, activities, known);
  const { completed, inserted } = await applyImport(deps, input.userId, planActivityImport(activities, workouts, nowIso, focus));

  const parts = mergeDays(await fetchWellness(mcp, deps.logger, from, to, days, input.timezone), from, to);
  const metricsDays = parts.length ? await deps.store.upsertMetrics(input.userId, 'coros', toMetricRows(parts, nowIso)) : 0;
  return {
    metricsDays,
    activitiesImported: inserted,
    workoutsCompleted: completed,
    message: `COROS sincronizado: ${metricsDays} días de bienestar, ${completed} entrenos completados y ${inserted} actividades nuevas.`,
  };
}
