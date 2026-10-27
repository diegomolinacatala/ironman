/**
 * Garmin credential lifecycle: encrypt/store the Personal API key, run a sync
 * with it and keep `integration_credentials.state` up to date.
 */
import { decryptSecret, encryptSecret } from '../crypto.ts';
import { DEFAULT_TZ, todayIn } from '../dates.ts';
import { errorInfo } from '../log.ts';
import type { ISODate, ISODateTime, IntegrationStatus, SyncResult, UUID } from '../types.ts';
import { GarminApiError } from './api.ts';
import { FIRST_SYNC_DAYS, SYNC_DAYS, syncGarminUser } from './sync.ts';
import type { GarminSyncDeps } from './sync.ts';

export const PROVIDER = 'garmin_personal';

export interface GarminCredential {
  userId: UUID;
  ciphertext: string;
  keyExpiresAt: ISODate | null;
  state: IntegrationStatus['state'];
  lastSyncAt: ISODateTime | null;
  lastError: string | null;
}

export interface CredentialStore {
  getCredential(userId: UUID): Promise<GarminCredential | null>;
  saveCredential(userId: UUID, value: { ciphertext: string; keyExpiresAt: ISODate | null }): Promise<void>;
  updateCredentialState(
    userId: UUID,
    value: { state: IntegrationStatus['state']; lastError: string | null; lastSyncAt?: ISODateTime },
  ): Promise<void>;
  deleteCredential(userId: UUID): Promise<void>;
  /** Credentials with state connected or error (candidates for the scheduled sync). */
  listSyncable(): Promise<GarminCredential[]>;
  getTimezone(userId: UUID): Promise<string | null>;
}

export const EXPIRED_MESSAGE =
  'Tu clave de Garmin ha caducado o se ha revocado. Crea una nueva en Garmin Connect (Ajustes › Personal API) y vuelve a conectarla en Road to Ironman.';

export const cipherContext = (userId: UUID): string => `${PROVIDER}:${userId}`;

export function encryptApiKey(apiKey: string, keySecret: string, userId: UUID): Promise<string> {
  return encryptSecret(apiKey, keySecret, cipherContext(userId));
}

export function statusOf(c: GarminCredential | null): IntegrationStatus {
  return {
    provider: PROVIDER,
    state: c?.state ?? 'disconnected',
    expiresAt: c?.keyExpiresAt ?? null,
    lastSyncAt: c?.lastSyncAt ?? null,
    lastError: c?.lastError ?? null,
  };
}

export type SyncOutcome =
  | { ok: true; result: SyncResult; status: IntegrationStatus }
  | { ok: false; code: 'expired' | 'failed'; message: string; status: IntegrationStatus };

export interface CredentialSyncDeps extends GarminSyncDeps {
  credentials: CredentialStore;
  keySecret: string;
}

async function markState(
  deps: CredentialSyncDeps,
  c: GarminCredential,
  state: IntegrationStatus['state'],
  lastError: string | null,
  lastSyncAt?: ISODateTime,
): Promise<IntegrationStatus> {
  await deps.credentials.updateCredentialState(c.userId, { state, lastError, ...(lastSyncAt ? { lastSyncAt } : {}) });
  return statusOf({ ...c, state, lastError, lastSyncAt: lastSyncAt ?? c.lastSyncAt });
}

export interface SyncOptions {
  /** Days back to sync; default 28 for a credential that never synced, else 14. */
  days?: number;
}

/** Decrypts the key, syncs and records the resulting state. Never throws for Garmin errors. */
export async function syncWithCredential(deps: CredentialSyncDeps, c: GarminCredential, options: SyncOptions = {}): Promise<SyncOutcome> {
  const now = deps.now();
  const days = options.days ?? (c.lastSyncAt ? SYNC_DAYS : FIRST_SYNC_DAYS);
  const tz = (await deps.credentials.getTimezone(c.userId)) ?? DEFAULT_TZ;
  if (c.keyExpiresAt && c.keyExpiresAt < todayIn(tz, now)) {
    return { ok: false, code: 'expired', message: EXPIRED_MESSAGE, status: await markState(deps, c, 'expired', EXPIRED_MESSAGE) };
  }
  try {
    const apiKey = await decryptSecret(c.ciphertext, deps.keySecret, cipherContext(c.userId));
    const result = await syncGarminUser(deps, { userId: c.userId, apiKey, timezone: tz, days });
    return { ok: true, result, status: await markState(deps, c, 'connected', null, now.toISOString()) };
  } catch (error) {
    if (error instanceof GarminApiError && (error.status === 401 || error.status === 403)) {
      return { ok: false, code: 'expired', message: EXPIRED_MESSAGE, status: await markState(deps, c, 'expired', EXPIRED_MESSAGE) };
    }
    deps.logger.warn('garmin sync failed', { userId: c.userId, ...errorInfo(error) });
    const message =
      error instanceof GarminApiError ? `No se pudo sincronizar con Garmin (${error.message}). Lo reintentaremos más tarde.` : 'No se pudo sincronizar con Garmin. Lo reintentaremos más tarde.';
    return { ok: false, code: 'failed', message, status: await markState(deps, c, 'error', message) };
  }
}
