/**
 * Light Garmin pull for the wake-up sweep: only today's sleep. Two Personal API
 * calls (key → token, then dailySleepSummariesByDate for one day) instead of the
 * full sync's six, merged into daily_metrics (source 'garmin') like the sync.
 * Garmin publishes the night once the watch has synced after the athlete woke
 * up, so an empty answer just means "not yet".
 */
import { decryptSecret } from '../crypto.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { PlanningStore } from '../planning/store.ts';
import type { ISODate, UUID } from '../types.ts';
import { GarminApiError } from './api.ts';
import type { GarminApi } from './api.ts';
import { EXPIRED_MESSAGE, cipherContext } from './credentials.ts';
import type { CredentialStore } from './credentials.ts';
import { mergeDayParts, parseSleepSummaries } from './parse.ts';
import { toMetricRows } from './sync.ts';

export const SLEEP_PATH = '/sleep-service/sleep/dailySleepSummariesByDate';

export interface SleepPullDeps {
  api: GarminApi;
  store: Pick<PlanningStore, 'upsertMetrics'>;
  credentials: Pick<CredentialStore, 'getCredential' | 'updateCredentialState'>;
  keySecret: string;
  now: () => Date;
  logger: Logger;
}

export interface PulledNight {
  start: string | null;
  end: string | null;
}

/** Today's night (ISO start/end) after storing it, or null (not connected, nothing yet, Garmin error). */
export async function pullTodaySleep(deps: SleepPullDeps, userId: UUID, timezone: string, today: ISODate): Promise<PulledNight | null> {
  const credential = await deps.credentials.getCredential(userId);
  if (!credential || (credential.state !== 'connected' && credential.state !== 'error')) return null;
  if (credential.keyExpiresAt && credential.keyExpiresAt < today) return null;
  try {
    const apiKey = await decryptSecret(credential.ciphertext, deps.keySecret, cipherContext(userId));
    const token = await deps.api.exchangeKey(apiKey);
    const payload = await deps.api.get(SLEEP_PATH, token, { startDate: today, endDate: today });
    const part = mergeDayParts(parseSleepSummaries(payload, timezone), today, today)[0];
    if (!part) return null;
    await deps.store.upsertMetrics(userId, 'garmin', toMetricRows([part], deps.now().toISOString()));
    return { start: part.sleepStart ?? null, end: part.sleepEnd ?? null };
  } catch (error) {
    if (error instanceof GarminApiError && (error.status === 401 || error.status === 403)) {
      await deps.credentials.updateCredentialState(userId, { state: 'expired', lastError: EXPIRED_MESSAGE });
      return null;
    }
    deps.logger.warn('garmin sleep pull failed', { userId, ...errorInfo(error) });
    return null;
  }
}
