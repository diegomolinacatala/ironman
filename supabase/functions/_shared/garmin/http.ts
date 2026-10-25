/**
 * `POST /garmin` with `{ action }`:
 * - connect {apiKey, expiresAt?} (user JWT): validate key with Garmin, encrypt, store, first sync.
 * - disconnect (user JWT): delete the stored key.
 * - sync (user JWT): sync now.
 * - sync_all (server secret key in `apikey`): scheduled sync of every connected user.
 */
import { dateSchema } from '../planning/changes.ts';
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import { errorInfo } from '../log.ts';
import { enumOf, nullable, object, optional, string } from '../schema.ts';
import { hasServiceKey } from '../secrets.ts';
import type { UUID } from '../types.ts';
import { GarminApiError } from './api.ts';
import { encryptApiKey, statusOf, syncWithCredential } from './credentials.ts';
import type { CredentialSyncDeps } from './credentials.ts';

export interface GarminHttpDeps extends Omit<CredentialSyncDeps, 'keySecret'> {
  keySecret: string | undefined;
  authenticate: (req: Request) => Promise<UUID | null>;
  secretKeys: readonly string[];
  /** Wall-clock budget for sync_all (ms). */
  syncAllBudgetMs?: number;
}

const bodySchema = object(
  {
    action: enumOf(['connect', 'disconnect', 'sync', 'sync_all'] as const),
    apiKey: optional(string({ min: 16, max: 4096, pattern: /^\S+$/, hint: 'la clave tal cual, sin espacios' })),
    expiresAt: optional(nullable(dateSchema())),
  },
  undefined,
  { stripUnknown: true },
);

async function connect(deps: GarminHttpDeps & { keySecret: string }, userId: UUID, apiKey: string, expiresAt: string | null): Promise<Response> {
  try {
    await deps.api.exchangeKey(apiKey);
  } catch (error) {
    if (error instanceof GarminApiError && error.status >= 400 && error.status < 500) {
      return errorResponse(400, 'invalid_key', 'Garmin no acepta esta clave. Copia la Personal API Key completa desde Garmin Connect (Ajustes › Personal API) y comprueba que no haya caducado.');
    }
    deps.logger.warn('garmin key validation failed', errorInfo(error));
    return errorResponse(502, 'garmin_unavailable', 'No hemos podido contactar con Garmin. Inténtalo de nuevo en unos minutos.');
  }
  const ciphertext = await encryptApiKey(apiKey, deps.keySecret, userId);
  await deps.credentials.saveCredential(userId, { ciphertext, keyExpiresAt: expiresAt });
  const saved = await deps.credentials.getCredential(userId);
  if (!saved) return errorResponse(500, 'internal', 'No se pudo guardar la clave de Garmin.');
  const outcome = await syncWithCredential({ ...deps, keySecret: deps.keySecret }, saved);
  return json({ ...outcome.status, sync: outcome.ok ? outcome.result : null });
}

async function syncOne(deps: GarminHttpDeps & { keySecret: string }, userId: UUID): Promise<Response> {
  const credential = await deps.credentials.getCredential(userId);
  if (!credential) return errorResponse(404, 'not_connected', 'Garmin no está conectado. Añade tu Personal API Key en Ajustes › Integraciones.');
  const outcome = await syncWithCredential({ ...deps, keySecret: deps.keySecret }, credential);
  if (outcome.ok) return json(outcome.result);
  return outcome.code === 'expired'
    ? errorResponse(409, 'garmin_expired', outcome.message)
    : errorResponse(502, 'garmin_unavailable', outcome.message);
}

async function syncAll(deps: GarminHttpDeps & { keySecret: string }): Promise<Response> {
  const started = deps.now().getTime();
  const budget = deps.syncAllBudgetMs ?? 100_000;
  const credentials = await deps.credentials.listSyncable();
  const summary = { users: credentials.length, ok: 0, expired: 0, failed: 0, skipped: 0 };
  for (const c of credentials) {
    if (deps.now().getTime() - started > budget) {
      summary.skipped += 1;
      continue;
    }
    const outcome = await syncWithCredential({ ...deps, keySecret: deps.keySecret }, c);
    if (outcome.ok) summary.ok += 1;
    else if (outcome.code === 'expired') summary.expired += 1;
    else summary.failed += 1;
  }
  deps.logger.info('garmin sync_all done', summary);
  return json(summary);
}

async function route(req: Request, deps: GarminHttpDeps & { keySecret: string }): Promise<Response> {
  const parsed = bodySchema.parse(await readJson(req), '');
  if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  const { action, apiKey, expiresAt } = parsed.value;
  if (action === 'sync_all') {
    return hasServiceKey(req.headers, deps.secretKeys) ? syncAll(deps) : errorResponse(401, 'unauthorized', 'Clave de servidor no válida.');
  }
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo.');
  if (action === 'connect') {
    if (!apiKey) return errorResponse(400, 'bad_request', 'Falta apiKey: pega tu Personal API Key de Garmin.');
    return connect(deps, userId, apiKey, expiresAt ?? null);
  }
  if (action === 'disconnect') {
    await deps.credentials.deleteCredential(userId);
    return json({ ...statusOf(null), ok: true });
  }
  return syncOne(deps, userId);
}

export async function handleGarminHttp(req: Request, deps: GarminHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  const keySecret = deps.keySecret;
  if (!keySecret || keySecret.length < 16) {
    deps.logger.error('GARMIN_KEY_SECRET missing or too short');
    return errorResponse(503, 'server_misconfigured', 'La integración con Garmin no está configurada en el servidor.');
  }
  try {
    return await route(req, { ...deps, keySecret });
  } catch (error) {
    const bodyError = bodyErrorResponse(error);
    if (bodyError) return bodyError;
    deps.logger.error('garmin request failed', errorInfo(error));
    return errorResponse(500, 'internal', 'Error inesperado con Garmin. Inténtalo de nuevo.');
  }
}
