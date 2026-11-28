/**
 * After each Garmin sync: downloads the activity file of the newest analysable
 * sessions (bike and run, ≥ 20 min, from Garmin, not analysed yet) and stores
 * the per-second metrics in `completed` (streamMetrics.ts): normalized power,
 * IF, power curve, aerobic decoupling and heart-rate drift.
 *
 * At most MAX_PER_SYNC files per sync (each is one more Garmin call and a few
 * hundred KB), newest first: the scheduled sync works through the backlog.
 * `analyzedAt` is written also when the file had nothing to measure or does
 * not exist (404), so each activity is downloaded once; a timeout or a Garmin
 * error leaves it for the next sync. Never throws: the sync result stands.
 */
import { errorInfo } from '../log.ts';
import type { Logger } from '../log.ts';
import type { CompletedData, UUID, Workout } from '../types.ts';
import { GarminApiError } from './api.ts';
import type { GarminApi, GarminToken } from './api.ts';
import { FitError, fitFromDownload } from './fit.ts';
import { computeStreamMetrics } from './streamMetrics.ts';
import type { AnalysedSport, StreamMetrics } from './streamMetrics.ts';

export const MAX_PER_SYNC = 4;
const MIN_DURATION_MIN = 20;

export interface AnalysisStore {
  saveActivityAnalysis(userId: UUID, workoutId: UUID, externalId: string, analysis: Partial<CompletedData>): Promise<boolean>;
}

export interface AnalysisDeps {
  api: GarminApi;
  store: AnalysisStore;
  logger: Logger;
}

export interface AnalysisCandidate {
  workoutId: UUID;
  activityId: string;
  sport: AnalysedSport;
}

/** Pure: the sessions whose Garmin file is worth reading, newest first. */
export function analysisCandidates(workouts: readonly Workout[], limit: number = MAX_PER_SYNC): AnalysisCandidate[] {
  return workouts
    .filter((w) => {
      const c = w.completed;
      if (w.status !== 'completed' || !c || c.source !== 'garmin' || !c.externalId || c.analyzedAt) return false;
      if (w.sport !== 'bike' && w.sport !== 'run') return false;
      return (c.durationMin ?? w.durationMin) >= MIN_DURATION_MIN;
    })
    .sort((a, b) => (b.date + (b.startTime ?? '')).localeCompare(a.date + (a.startTime ?? '')))
    .slice(0, limit)
    .map((w) => ({ workoutId: w.id, activityId: w.completed?.externalId ?? '', sport: w.sport as AnalysedSport }));
}

/**
 * The fields to merge: the computed ones, without overwriting the 1 and 20-minute
 * bests Garmin's summary already gave (same numbers, Garmin's own rounding).
 */
export function analysisPatch(metrics: StreamMetrics, completed: CompletedData | null | undefined, analyzedAt: string): Partial<CompletedData> {
  const patch: Partial<CompletedData> = { ...metrics, analyzedAt };
  if (completed?.bestPower1MinW != null) delete patch.bestPower1MinW;
  if (completed?.bestPower20MinW != null) delete patch.bestPower20MinW;
  return patch;
}

export async function analyzeGarminActivities(
  deps: AnalysisDeps,
  input: { userId: UUID; token: GarminToken; workouts: readonly Workout[]; ftpW?: number; nowIso: string },
): Promise<number> {
  let analysed = 0;
  for (const c of analysisCandidates(input.workouts)) {
    let metrics: StreamMetrics = {};
    try {
      const bytes = await deps.api.getBytes(`/download-service/files/activity/${encodeURIComponent(c.activityId)}`, input.token);
      metrics = computeStreamMetrics({ sport: c.sport, samples: await fitFromDownload(bytes), ftpW: input.ftpW });
    } catch (error) {
      const gone = error instanceof GarminApiError && error.status === 404;
      if (!gone && !(error instanceof FitError)) {
        deps.logger.warn('garmin activity file failed', { activity: c.activityId, ...errorInfo(error) });
        if (error instanceof GarminApiError && (error.status === 401 || error.status === 429)) break;
        continue;
      }
    }
    const completed = input.workouts.find((w) => w.id === c.workoutId)?.completed;
    try {
      if (await deps.store.saveActivityAnalysis(input.userId, c.workoutId, c.activityId, analysisPatch(metrics, completed, input.nowIso))) analysed += 1;
    } catch (error) {
      deps.logger.warn('garmin analysis not saved', { workout: c.workoutId, ...errorInfo(error) });
    }
  }
  return analysed;
}
