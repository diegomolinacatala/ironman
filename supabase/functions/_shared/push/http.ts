/**
 * `POST /push-dispatch` (pg_net trigger + pg_cron sweep `{action:'sweep'}`).
 * Auth: server secret key in `apikey`. On sweeps, a background task
 * (EdgeRuntime.waitUntil) also prunes tokens not seen for STALE_TOKEN_DAYS.
 */
import { errorResponse, json, methodNotAllowed, readJson } from '../http.ts';
import { errorInfo } from '../log.ts';
import { hasServiceKey } from '../secrets.ts';
import { dispatchPending } from './dispatch.ts';
import type { DispatchDeps } from './dispatch.ts';

/** Tokens whose app has not re-registered them (last_seen_at) for this long are deleted. */
export const STALE_TOKEN_DAYS = 90;

export interface PushHttpDeps extends DispatchDeps {
  secretKeys: readonly string[];
  /** Runs follow-up work after the response (EdgeRuntime.waitUntil in production). */
  background?: (task: Promise<unknown>) => void;
}

async function isSweep(req: Request): Promise<boolean> {
  try {
    const body = await readJson(req, 4096);
    return !!body && typeof body === 'object' && (body as { action?: unknown }).action === 'sweep';
  } catch {
    return false;
  }
}

/** Stale-token pruning. Best effort: logs and never throws. */
export async function pruneStaleTokens(deps: Pick<PushHttpDeps, 'store' | 'now' | 'logger'>): Promise<void> {
  try {
    const before = new Date(deps.now().getTime() - STALE_TOKEN_DAYS * 86_400_000).toISOString();
    const pruned = await deps.store.pruneStaleTokens(before);
    if (pruned > 0) deps.logger.info('stale push tokens pruned', { pruned });
  } catch (error) {
    deps.logger.warn('stale push token pruning failed', errorInfo(error));
  }
}

export async function handlePushHttp(req: Request, deps: PushHttpDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  if (deps.secretKeys.length === 0) {
    deps.logger.error('push-dispatch has no secret keys configured');
    return errorResponse(500, 'server_misconfigured', 'Faltan las claves del servidor.');
  }
  if (!hasServiceKey(req.headers, deps.secretKeys)) return errorResponse(401, 'unauthorized', 'Clave de servidor no válida.');
  try {
    // The trigger payload is not needed (we always sweep the queue); only the cron marker matters.
    const sweep = await isSweep(req);
    const summary = await dispatchPending(deps);
    if (summary.claimed > 0) deps.logger.info('push dispatched', { ...summary });
    if (sweep) deps.background?.(pruneStaleTokens(deps));
    return json(summary);
  } catch (error) {
    deps.logger.error('push dispatch failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudieron enviar las notificaciones.');
  }
}
