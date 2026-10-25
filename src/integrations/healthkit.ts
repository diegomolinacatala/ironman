/**
 * Apple Health (HealthKit) integration — native implementation.
 * Web resolves `healthkit.web.ts` instead (Metro platform extensions); on
 * Android the library's own stub reports HealthKit as unavailable.
 *
 * Rule from the library README: request authorization BEFORE any query,
 * otherwise the app crashes. Every query path goes through `ensureAuthorized()`.
 */
import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  type QuantityTypeIdentifier,
  type UnitForIdentifier,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';

import type { Repository } from '@/data/repository';
import type { ISODate } from '@/domain/types';
import { logger } from '@/lib/logger';

import { assertSessionUser, sessionUserId } from './deviceState';
import { importActivities, toImportCandidate, type HealthActivity, type ImportCandidate } from './health/importer';
import {
  buildMetricsDrafts,
  localDate,
  quantityToMeters,
  quantityToMinutes,
  sleepHoursByDate,
  statsByDate,
  type DailyHealthSeries,
  type DailyStatLike,
} from './health/mapping';
import { getImportedHealthIds, isHealthEnabled, rememberImportedHealthIds, setHealthLastSync } from './health/state';

export { getHealthLastSync, isHealthEnabled, setHealthEnabled } from './health/state';

export interface HealthSyncResult {
  metricsDays: number;
  workoutsCompleted: number;
  activitiesImported: number;
}

/**
 * Exactly the types this file queries (App Review: ask only for what you read
 * and keep NSHealthShareUsageDescription in sync): workouts and their heart
 * rate, resting heart rate, HRV, sleep, VO2max and steps.
 */
export const HEALTH_READ_TYPES = [
  'HKWorkoutTypeIdentifier',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierVO2Max',
  'HKQuantityTypeIdentifierStepCount',
] as const;

const EMPTY_RESULT: HealthSyncResult = { metricsDays: 0, workoutsCompleted: 0, activitiesImported: 0 };

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const HOUR_MS = 3_600_000;
/** Sleep that ended on the first day started the evening before. */
const SLEEP_LOOKBACK_MS = 12 * HOUR_MS;
const DAILY = { day: 1 } as const;

let authorizationRequested = false;
let inFlight: Promise<HealthSyncResult> | null = null;

export function isHealthAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isHealthDataAvailable();
  } catch (error) {
    logger.warn('healthkit: availability check failed', error);
    return false;
  }
}

/** Shows the Health permission sheet (only for types not asked yet). True when the request was processed. */
export async function requestHealthPermissions(): Promise<boolean> {
  if (!isHealthAvailable()) return false;
  try {
    const processed = await requestAuthorization({ toRead: HEALTH_READ_TYPES });
    authorizationRequested = processed;
    return processed;
  } catch (error) {
    logger.error('healthkit: authorization failed', error);
    return false;
  }
}

async function ensureAuthorized(): Promise<void> {
  if (authorizationRequested) return;
  const ok = await requestHealthPermissions();
  if (!ok) throw new Error('No se pudo acceder a Apple Salud. Revisa los permisos en Ajustes > Salud.');
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function datesBetween(from: Date, to: Date): ISODate[] {
  const days = Math.max(0, Math.round((startOfLocalDay(to).getTime() - from.getTime()) / (24 * HOUR_MS)));
  return Array.from({ length: days + 1 }, (_, i) =>
    localDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, 12)),
  );
}

async function safely<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logger.warn(`healthkit: ${label} query failed`, error);
    return fallback;
  }
}

/** One bucket per local day: discrete average (HR, HRV, VO2max) or cumulative sum (steps). */
async function dailyStat<T extends QuantityTypeIdentifier>(
  identifier: T,
  kind: 'discreteAverage' | 'cumulativeSum',
  unit: UnitForIdentifier<T>,
  from: Date,
  to: Date,
): Promise<Record<ISODate, number>> {
  const rows = await queryStatisticsCollectionForQuantity(identifier, [kind], from, DAILY, {
    filter: { date: { startDate: from, endDate: to } },
    unit,
  });
  const stats: DailyStatLike[] = rows.map((r) => ({
    startDate: r.startDate,
    quantity: kind === 'cumulativeSum' ? r.sumQuantity : r.averageQuantity,
  }));
  return statsByDate(stats);
}

async function sleepByDay(from: Date, to: Date): Promise<Record<ISODate, number>> {
  const samples = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    limit: 0,
    ascending: true,
    filter: { date: { startDate: new Date(from.getTime() - SLEEP_LOOKBACK_MS), endDate: to } },
  });
  return sleepHoursByDate(samples.map((s) => ({ startDate: s.startDate, endDate: s.endDate, value: Number(s.value) })));
}

async function readDailySeries(from: Date, to: Date): Promise<DailyHealthSeries> {
  const [restingHr, hrvMs, steps, vo2max, sleepHours] = await Promise.all([
    safely('resting hr', {}, () => dailyStat('HKQuantityTypeIdentifierRestingHeartRate', 'discreteAverage', 'count/min', from, to)),
    safely('hrv', {}, () => dailyStat('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'discreteAverage', 'ms', from, to)),
    safely('steps', {}, () => dailyStat('HKQuantityTypeIdentifierStepCount', 'cumulativeSum', 'count', from, to)),
    safely('vo2max', {}, () => dailyStat('HKQuantityTypeIdentifierVO2Max', 'discreteAverage', 'ml/(kg*min)', from, to)),
    safely('sleep', {}, () => sleepByDay(from, to)),
  ]);
  return { restingHr, hrvMs, steps, vo2max, sleepHours };
}

async function readActivities(from: Date, to: Date): Promise<HealthActivity[]> {
  const workouts = await queryWorkoutSamples({ limit: 0, ascending: true, filter: { date: { startDate: from, endDate: to } } });
  try {
    return await Promise.all(
      workouts.map(async (w): Promise<HealthActivity> => {
        const json = w.toJSON();
        const hr = await w.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min').catch(() => undefined);
        const durationMin =
          quantityToMinutes(json.duration) ?? (json.endDate.getTime() - json.startDate.getTime()) / 60_000;
        return {
          uuid: json.uuid,
          activityType: Number(json.workoutActivityType),
          start: json.startDate,
          end: json.endDate,
          durationMin,
          distanceM: quantityToMeters(json.totalDistance),
          avgHr: hr?.averageQuantity?.quantity ?? null,
        };
      }),
    );
  } finally {
    workouts.forEach((w) => {
      try {
        w.dispose();
      } catch {
        // Already released: nothing to do.
      }
    });
  }
}

async function runSync(repo: Repository, days: number): Promise<HealthSyncResult> {
  // Only the account that enabled Apple Salud on this device gets its data.
  const userId = await sessionUserId(repo);
  if (!userId || !(await isHealthEnabled(userId))) return EMPTY_RESULT;
  await ensureAuthorized();
  const now = new Date();
  const from = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
  const dates = datesBetween(from, now);

  const [series, activities] = await Promise.all([readDailySeries(from, now), readActivities(from, now)]);

  await assertSessionUser(repo, userId);
  const drafts = buildMetricsDrafts(dates, series);
  if (drafts.length > 0) await repo.upsertMetrics(drafts);

  const candidates = activities.map(toImportCandidate).filter((c): c is ImportCandidate => c !== null);
  const knownIds = await getImportedHealthIds(userId);
  const range = { from: dates[0] ?? localDate(now), to: localDate(now) };
  const result = await importActivities(repo, candidates, { range, knownIds });
  await rememberImportedHealthIds(userId, knownIds, result.handledIds);
  await setHealthLastSync(userId, new Date().toISOString());

  return {
    metricsDays: drafts.length,
    workoutsCompleted: result.workoutsCompleted,
    activitiesImported: result.activitiesImported,
  };
}

/**
 * Reads the last `days` of Apple Health data: upserts daily metrics (source
 * 'healthkit') and imports workouts (completing planned ones when they match).
 * No-op unless the signed-in account enabled Apple Salud on this device.
 * Concurrent calls share the same run.
 */
export async function syncHealth(repo: Repository, opts?: { days?: number }): Promise<HealthSyncResult> {
  if (!isHealthAvailable()) return EMPTY_RESULT;
  if (inFlight) return inFlight;
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(opts?.days ?? DEFAULT_DAYS)));
  inFlight = runSync(repo, days).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
