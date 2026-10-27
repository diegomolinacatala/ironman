/**
 * Garmin Personal API sync (last 14 days; 28 on the first sync after connecting, so
 * baselines such as the 7-night HRV are there from day one): daily metrics → daily_metrics
 * (source 'garmin', merge per field), activities → complete matching planned
 * workouts or insert completed unplanned ones (external_id 'garmin:<id>').
 * Activities already recorded by another source (Garmin Connect → Apple
 * Health → app) are skipped so load and totals are not counted twice.
 */
import { addDays, todayIn } from '../dates.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { sportLabel } from '../planning/labels.ts';
import { intensityFromEffort } from '../planning/load.ts';
import { findCompletedLookalike, matchActivity } from '../planning/match.ts';
import type { CompletedWorkoutInsert, MetricsUpsert, PlanningStore } from '../planning/store.ts';
import type { CompletedData, SyncResult, UUID, Workout } from '../types.ts';
import { GarminApiError } from './api.ts';
import type { GarminApi, GarminToken } from './api.ts';
import { mergeDayParts, parseActivities, parseBodyBattery, parseDailySummaries, parseHrv, parseSleepSummaries } from './parse.ts';
import type { DayMetricsPart, GarminActivity } from './parse.ts';

export const SYNC_DAYS = 14;
/** First sync after `connect` (sleep and Body Battery endpoints accept at most 28 days per call). */
export const FIRST_SYNC_DAYS = 28;
const MAX_SYNC_DAYS = 28;

export type GarminSyncStore = Pick<PlanningStore, 'listWorkouts' | 'completeWorkout' | 'insertCompletedWorkout' | 'upsertMetrics'>;

export interface GarminSyncDeps {
  api: GarminApi;
  store: GarminSyncStore;
  now: () => Date;
  logger: Logger;
}

export interface ImportPlan {
  completions: { workoutId: UUID; completed: CompletedData }[];
  inserts: CompletedWorkoutInsert[];
  skipped: number;
}

function completedFor(a: GarminActivity, nowIso: string): CompletedData {
  return {
    source: 'garmin',
    externalId: a.id,
    durationMin: a.durationMin,
    ...(a.distanceM !== null ? { distanceM: a.distanceM } : {}),
    ...(a.avgHr !== null ? { avgHr: a.avgHr } : {}),
    ...(a.tss !== null ? { tss: a.tss } : {}),
    completedAt: nowIso,
  };
}

/** Pure: decides what to do with each activity given the user's workouts in the window. */
export function planActivityImport(activities: readonly GarminActivity[], workouts: readonly Workout[], nowIso: string): ImportPlan {
  const known = new Set<string>();
  for (const w of workouts) {
    if (w.externalId) known.add(w.externalId);
    if (w.completed?.externalId) known.add(`garmin:${w.completed.externalId}`);
  }
  const used = new Set<UUID>();
  const plan: ImportPlan = { completions: [], inserts: [], skipped: 0 };
  const ordered = [...activities].sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  for (const a of ordered) {
    if (known.has(`garmin:${a.id}`)) {
      plan.skipped += 1;
      continue;
    }
    known.add(`garmin:${a.id}`);
    if (findCompletedLookalike(a, workouts, { garminId: a.id })) {
      plan.skipped += 1;
      continue;
    }
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
      intensity: intensityFromEffort({ tss: a.tss, durationMin: a.durationMin }),
      completed,
      source: 'garmin',
      externalId: `garmin:${a.id}`,
    });
  }
  return plan;
}

export function toMetricRows(parts: readonly DayMetricsPart[], nowIso: string): MetricsUpsert[] {
  return parts.map((p) => ({ ...p, raw: { source: 'Garmin', via: 'personal_api', syncedAt: nowIso } }));
}

interface Fetched {
  dailies: unknown;
  sleep: unknown;
  hrv: unknown;
  bodyBattery: unknown;
  activities: unknown;
}

async function fetchAll(deps: GarminSyncDeps, token: GarminToken, from: string, to: string, days: number): Promise<Fetched> {
  const range = { startDate: from, endDate: to };
  const activityLimit = days > SYNC_DAYS ? 100 : 50;
  const calls = [
    deps.api.get('/usersummary-service/v2/dailysummaries', token, range),
    deps.api.get('/sleep-service/sleep/dailySleepSummariesByDate', token, range),
    deps.api.get(`/hrv-service/hrv/daily/${from}/${to}`, token),
    deps.api.get('/wellness-service/wellness/bodyBattery/reports/daily', token, range),
    deps.api.get('/activitylist-service/activities/search/activities', token, { start: 0, limit: activityLimit, ...range }),
  ];
  const settled = await Promise.allSettled(calls);
  const unauthorized = settled.find((s) => s.status === 'rejected' && s.reason instanceof GarminApiError && s.reason.status === 401);
  if (unauthorized) throw new GarminApiError(401, 'Clave de Garmin caducada o revocada.');
  if (settled.every((s) => s.status === 'rejected')) throw new GarminApiError(503, 'Garmin no ha devuelto ningún dato.');
  settled.forEach((s, i) => {
    if (s.status === 'rejected') deps.logger.warn('garmin endpoint failed', { endpoint: i, ...errorInfo(s.reason) });
  });
  const value = (i: number): unknown => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<unknown>).value : null);
  return { dailies: value(0), sleep: value(1), hrv: value(2), bodyBattery: value(3), activities: value(4) };
}

async function applyImport(deps: GarminSyncDeps, userId: UUID, plan: ImportPlan): Promise<{ completed: number; inserted: number }> {
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
  apiKey: string;
  timezone: string;
  /** Days back from today, inclusive (default SYNC_DAYS, max 28). */
  days?: number;
}

/** Syncs one user. Throws GarminApiError(401) when the key is no longer valid. */
export async function syncGarminUser(deps: GarminSyncDeps, input: SyncUserInput): Promise<SyncResult> {
  const token = await deps.api.exchangeKey(input.apiKey);
  const now = deps.now();
  const nowIso = now.toISOString();
  const days = Math.max(1, Math.min(MAX_SYNC_DAYS, Math.round(input.days ?? SYNC_DAYS)));
  const to = todayIn(input.timezone, now);
  const from = addDays(to, -(days - 1));
  const data = await fetchAll(deps, token, from, to, days);
  const parts = mergeDayParts(
    [
      ...parseDailySummaries(data.dailies),
      ...parseSleepSummaries(data.sleep, input.timezone),
      ...parseHrv(data.hrv),
      ...parseBodyBattery(data.bodyBattery),
    ],
    from,
    to,
  );
  const metricsDays = parts.length ? await deps.store.upsertMetrics(input.userId, 'garmin', toMetricRows(parts, nowIso)) : 0;
  const activities = parseActivities(data.activities, input.timezone).filter((a) => a.date >= from && a.date <= to);
  const workouts = await deps.store.listWorkouts(input.userId, from, to);
  const { completed, inserted } = await applyImport(deps, input.userId, planActivityImport(activities, workouts, nowIso));
  return {
    metricsDays,
    activitiesImported: inserted,
    workoutsCompleted: completed,
    message: `Garmin sincronizado: ${metricsDays} días de métricas, ${completed} entrenos completados y ${inserted} actividades nuevas.`,
  };
}
