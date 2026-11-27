/**
 * `/coros`:
 * - POST { action: 'start' } (user JWT): registers a COROS client for this connection and
 *   returns the COROS authorization URL (PKCE; the verifier travels encrypted in `state`).
 * - GET /coros/callback?code&state (from COROS, no JWT: the encrypted state identifies the
 *   user): exchanges the code, stores the encrypted token bundle, runs a first 28-day sync
 *   and redirects to the app (roadtoironman://settings/integrations?coros=connected|error).
 * - POST { action: 'sync' | 'disconnect' } (user JWT).
 * - POST { action: 'sync_all' } (server secret key in `apikey`): scheduled sync of every connection.
 */
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import { errorInfo } from '../log.ts';
import { enumOf, object } from '../schema.ts';
import { hasServiceKey } from '../secrets.ts';
import type { UUID } from '../types.ts';
import { EXPIRED_MESSAGE, statusOf, syncWithCredential } from './credentials.ts';
import type { CorosCredentialDeps } from './credentials.ts';
import { CorosApiError } from './mcp.ts';
import { authorizeUrl, decodeState, discoverEndpoints, encodeState, encryptBundle, exchangeCode, randomVerifier, registerClient, STATE_TTL_MS } from './oauth.ts';
import { FIRST_SYNC_DAYS } from './sync.ts';

export const APP_RETURN_URL = 'roadtoironman://settings/integrations';

export interface CorosHttpDeps extends Omit<CorosCredentialDeps, 'tokenSecret'> {
  tokenSecret: string | undefined;
  /** Public URL of GET /coros/callback, registered with COROS as the redirect URI. */
  callbackUrl: string | undefined;
  /** COROS MCP entry URL (default https://mcp.coros.com/mcp). */
  entryUrl?: string;
  authenticate: (req: Request) => Promise<UUID | null>;
  secretKeys: readonly string[];
  /** Wall-clock budget for sync_all (ms). */
  syncAllBudgetMs?: number;
}

type ReadyDeps = CorosHttpDeps & { tokenSecret: string; callbackUrl: string };

const bodySchema = object({ action: enumOf(['start', 'sync', 'disconnect', 'sync_all'] as const) }, undefined, { stripUnknown: true });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Redirect to the app, with a tiny page as fallback when the browser does not follow custom schemes. */
export function returnToApp(result: 'connected' | 'error', reason?: string): Response {
  const target = `${APP_RETURN_URL}?coros=${result}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
  const text = result === 'connected' ? 'COROS conectado. Vuelve a Road to Ironman.' : 'No se pudo conectar COROS. Vuelve a Road to Ironman e inténtalo de nuevo.';
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Road to Ironman</title><p>${escapeHtml(text)}</p><p><a href="${escapeHtml(target)}">Abrir Road to Ironman</a></p>`;
  return new Response(html, { status: 302, headers: { location: target, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function start(deps: ReadyDeps, userId: UUID): Promise<Response> {
  try {
    const endpoints = await discoverEndpoints(deps.fetch, deps.entryUrl);
    const client = await registerClient(deps.fetch, endpoints, deps.callbackUrl);
    const state = { userId, verifier: randomVerifier(), endpoints, client, expiresAt: deps.now().getTime() + STATE_TTL_MS };
    return json({ url: await authorizeUrl(state, await encodeState(state, deps.tokenSecret)) });
  } catch (error) {
    deps.logger.warn('coros start failed', errorInfo(error));
    return errorResponse(502, 'coros_unavailable', 'No hemos podido contactar con COROS. Inténtalo de nuevo en unos minutos.');
  }
}

async function callback(deps: ReadyDeps, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code || !rawState) return returnToApp('error', url.searchParams.get('error') ?? 'missing_code');
  const state = await decodeState(rawState, deps.tokenSecret, deps.now().getTime());
  if (!state) return returnToApp('error', 'expired_state');
  try {
    const bundle = await exchangeCode(deps.fetch, state, code, deps.now().getTime());
    await deps.credentials.saveCredential(state.userId, { ciphertext: await encryptBundle(bundle, deps.tokenSecret, state.userId), keyExpiresAt: null });
  } catch (error) {
    deps.logger.warn('coros token exchange failed', errorInfo(error));
    return returnToApp('error', 'token_exchange');
  }
  const saved = await deps.credentials.getCredential(state.userId);
  // The connection is saved even if this first sync fails: the scheduled one retries.
  if (saved) await syncWithCredential(deps, saved, { days: FIRST_SYNC_DAYS });
  return returnToApp('connected');
}

async function syncOne(deps: ReadyDeps, userId: UUID): Promise<Response> {
  const credential = await deps.credentials.getCredential(userId);
  if (!credential) return errorResponse(404, 'not_connected', 'COROS no está conectado. Pulsa «Conectar con COROS» en Tú › Conexiones.');
  const outcome = await syncWithCredential(deps, credential);
  if (outcome.ok) return json(outcome.result);
  return outcome.code === 'expired' ? errorResponse(409, 'coros_expired', EXPIRED_MESSAGE) : errorResponse(502, 'coros_unavailable', outcome.message);
}

async function syncAll(deps: ReadyDeps): Promise<Response> {
  const started = deps.now().getTime();
  const budget = deps.syncAllBudgetMs ?? 100_000;
  const credentials = await deps.credentials.listSyncable();
  const summary = { users: credentials.length, ok: 0, expired: 0, failed: 0, skipped: 0 };
  for (const c of credentials) {
    if (deps.now().getTime() - started > budget) {
      summary.skipped += 1;
      continue;
    }
    const outcome = await syncWithCredential(deps, c);
    if (outcome.ok) summary.ok += 1;
    else if (outcome.code === 'expired') summary.expired += 1;
    else summary.failed += 1;
  }
  deps.logger.info('coros sync_all done', summary);
  return json(summary);
}

async function routePost(req: Request, deps: ReadyDeps): Promise<Response> {
  const parsed = bodySchema.parse(await readJson(req), '');
  if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  const { action } = parsed.value;
  if (action === 'sync_all') {
    return hasServiceKey(req.headers, deps.secretKeys) ? syncAll(deps) : errorResponse(401, 'unauthorized', 'Clave de servidor no válida.');
  }
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo.');
  if (action === 'start') return start(deps, userId);
  if (action === 'disconnect') {
    await deps.credentials.deleteCredential(userId);
    return json({ ...statusOf(null), ok: true });
  }
  return syncOne(deps, userId);
}

export async function handleCorosHttp(req: Request, deps: CorosHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const { tokenSecret, callbackUrl } = deps;
  if (!tokenSecret || tokenSecret.length < 16 || !callbackUrl) {
    deps.logger.error('COROS_TOKEN_SECRET or the callback URL is missing');
    if (req.method === 'GET') return returnToApp('error', 'server_misconfigured');
    return errorResponse(503, 'server_misconfigured', 'La conexión con COROS no está configurada en el servidor.');
  }
  const ready: ReadyDeps = { ...deps, tokenSecret, callbackUrl };
  try {
    if (req.method === 'GET') return await callback(ready, new URL(req.url));
    if (req.method !== 'POST') return methodNotAllowed('GET, POST, OPTIONS');
    return await routePost(req, ready);
  } catch (error) {
    if (req.method === 'GET') {
      deps.logger.error('coros callback failed', errorInfo(error));
      return returnToApp('error', 'internal');
    }
    const bodyError = bodyErrorResponse(error);
    if (bodyError) return bodyError;
    deps.logger.error('coros request failed', errorInfo(error));
    return errorResponse(500, 'internal', error instanceof CorosApiError ? error.message : 'Error inesperado con COROS. Inténtalo de nuevo.');
  }
}
