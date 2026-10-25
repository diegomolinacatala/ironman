/**
 * `POST /push-dispatch` (pg_net trigger + pg_cron sweep `{action:'sweep'}`).
 * Auth: server secret key in `apikey`. After answering, a background task
 * (EdgeRuntime.waitUntil) checks Expo receipts of the sent tickets and, on
 * sweeps, prunes tokens not seen for STALE_TOKEN_DAYS.
 */
import { errorResponse, json, methodNotAllowed, readJson } from '../http.ts';
import { errorInfo } from '../log.ts';
import { hasServiceKey } from '../secrets.ts';
import { dispatchPending } from './dispatch.ts';
import type { DispatchDeps } from './dispatch.ts';
import { checkReceipts, STALE_TOKEN_DAYS } from './receipts.ts';

/** Wait before reading receipts of tickets sent in this call (they are usually ready within seconds). */
export const RECEIPT_CHECK_DELAY_MS = 10_000;

export interface PushHttpDeps extends DispatchDeps {
  secretKeys: readonly string[];
  /** Runs follow-up work after the response (EdgeRuntime.waitUntil in production). */
  background?: (task: Promise<unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function isSweep(req: Request): Promise<boolean> {
  try {
    const body = await readJson(req, 4096);
    return !!body && typeof body === 'object' && (body as { action?: unknown }).action === 'sweep';
  } catch {
    return false;
  }
}

/** Receipts + stale-token pruning. Best effort: logs and never throws. */
export async function pushFollowUp(deps: PushHttpDeps, sweep: boolean): Promise<void> {
  try {
    if (sweep) {
      const before = new Date(deps.now().getTime() - STALE_TOKEN_DAYS * 86_400_000).toISOString();
      const pruned = await deps.store.pruneStaleTokens(before);
      if (pruned > 0) deps.logger.info('stale push tokens pruned', { pruned });
    }
    if (!deps.receipts || deps.receipts.size() === 0) return;
    await (deps.sleep ?? defaultSleep)(RECEIPT_CHECK_DELAY_MS);
    const summary = await checkReceipts(deps, deps.receipts);
    if (summary.tokensRemoved > 0 || summary.errors > 0) deps.logger.info('expo receipts checked', { ...summary });
  } catch (error) {
    deps.logger.warn('push follow-up failed', errorInfo(error));
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
    deps.background?.(pushFollowUp(deps, sweep));
    return json(summary);
  } catch (error) {
    deps.logger.error('push dispatch failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudieron enviar las notificaciones.');
  }
}
