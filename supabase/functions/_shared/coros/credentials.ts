/**
 * COROS connection lifecycle: the encrypted token bundle lives in integration_credentials
 * (provider 'coros_mcp'); every sync refreshes the access token when needed, stores the
 * rotated refresh token and records the resulting state.
 */
import { DEFAULT_TZ } from '../dates.ts';
import { errorInfo } from '../log.ts';
import type { CredentialStore, GarminCredential } from '../garmin/credentials.ts';
import type { IntegrationStatus, ISODateTime, SyncResult } from '../types.ts';
import { CorosApiError, createCorosMcp } from './mcp.ts';
import type { FetchLike } from './mcp.ts';
import { decryptBundle, encryptBundle, freshBundle } from './oauth.ts';
import { FIRST_SYNC_DAYS, SYNC_DAYS, syncCorosUser } from './sync.ts';
import type { CorosSyncDeps } from './sync.ts';

export const PROVIDER = 'coros_mcp';

/** Same row shape as Garmin's (integration_credentials); keyExpiresAt is unused for COROS. */
export type CorosCredential = GarminCredential;

export const EXPIRED_MESSAGE =
  'COROS ya no acepta la conexión (caducada o revocada). Vuelve a pulsar «Conectar con COROS» en Tú › Conexiones.';

export function statusOf(c: CorosCredential | null): IntegrationStatus {
  return {
    provider: PROVIDER,
    state: c?.state ?? 'disconnected',
    expiresAt: null,
    lastSyncAt: c?.lastSyncAt ?? null,
    lastError: c?.lastError ?? null,
  };
}

export type SyncOutcome =
  | { ok: true; result: SyncResult; status: IntegrationStatus }
  | { ok: false; code: 'expired' | 'failed'; message: string; status: IntegrationStatus };

export interface CorosCredentialDeps extends CorosSyncDeps {
  credentials: CredentialStore;
  tokenSecret: string;
  fetch: FetchLike;
}

async function markState(
  deps: CorosCredentialDeps,
  c: CorosCredential,
  state: IntegrationStatus['state'],
  lastError: string | null,
  lastSyncAt?: ISODateTime,
): Promise<IntegrationStatus> {
  await deps.credentials.updateCredentialState(c.userId, { state, lastError, ...(lastSyncAt ? { lastSyncAt } : {}) });
  return statusOf({ ...c, state, lastError, lastSyncAt: lastSyncAt ?? c.lastSyncAt });
}

export interface SyncOptions {
  /** Days back to sync; default 28 for a connection that never synced, else 14. */
  days?: number;
}

/** Refreshes the token if needed, syncs and records the state. Never throws for COROS errors. */
export async function syncWithCredential(deps: CorosCredentialDeps, c: CorosCredential, options: SyncOptions = {}): Promise<SyncOutcome> {
  const days = options.days ?? (c.lastSyncAt ? SYNC_DAYS : FIRST_SYNC_DAYS);
  const tz = (await deps.credentials.getTimezone(c.userId)) ?? DEFAULT_TZ;
  try {
    const stored = await decryptBundle(c.ciphertext, deps.tokenSecret, c.userId);
    const { bundle, refreshed } = await freshBundle(deps.fetch, stored, deps.now().getTime());
    if (refreshed) {
      await deps.credentials.saveCredential(c.userId, { ciphertext: await encryptBundle(bundle, deps.tokenSecret, c.userId), keyExpiresAt: null });
    }
    const mcp = createCorosMcp({ resource: bundle.endpoints.resource, accessToken: bundle.accessToken, fetch: deps.fetch });
    const result = await syncCorosUser(deps, mcp, { userId: c.userId, timezone: tz, days });
    return { ok: true, result, status: await markState(deps, c, 'connected', null, deps.now().toISOString()) };
  } catch (error) {
    if (error instanceof CorosApiError && (error.status === 401 || error.status === 403)) {
      return { ok: false, code: 'expired', message: EXPIRED_MESSAGE, status: await markState(deps, c, 'expired', EXPIRED_MESSAGE) };
    }
    deps.logger.warn('coros sync failed', { userId: c.userId, ...errorInfo(error) });
    const message =
      error instanceof CorosApiError
        ? `No se pudo sincronizar con COROS (${error.message}). Lo reintentaremos más tarde.`
        : 'No se pudo sincronizar con COROS. Lo reintentaremos más tarde.';
    return { ok: false, code: 'failed', message, status: await markState(deps, c, 'error', message) };
  }
}
