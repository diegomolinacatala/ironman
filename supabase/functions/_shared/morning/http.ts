/**
 * `POST /morning` `{ action: 'sweep' }` — the wake-up sweep, called by pg_cron every
 * 5 minutes (private.morning_wake_tick) with the server secret key in `apikey`.
 */
import { errorResponse, json, methodNotAllowed, readJson } from '../http.ts';
import { errorInfo } from '../log.ts';
import { hasServiceKey } from '../secrets.ts';
import { runWakeSweep } from './sweep.ts';
import type { SweepDeps } from './sweep.ts';

export interface MorningHttpDeps extends SweepDeps {
  secretKeys: readonly string[];
}

async function isSweep(req: Request): Promise<boolean> {
  try {
    const body = await readJson(req, 4096);
    return !!body && typeof body === 'object' && (body as { action?: unknown }).action === 'sweep';
  } catch {
    return false;
  }
}

export async function handleMorningHttp(req: Request, deps: MorningHttpDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  if (deps.secretKeys.length === 0) {
    deps.logger.error('morning has no secret keys configured');
    return errorResponse(500, 'server_misconfigured', 'Faltan las claves del servidor.');
  }
  if (!hasServiceKey(req.headers, deps.secretKeys)) return errorResponse(401, 'unauthorized', 'Clave de servidor no válida.');
  if (!(await isSweep(req))) return errorResponse(400, 'bad_request', 'Acción no válida: usa {"action":"sweep"}.');
  try {
    const summary = await runWakeSweep(deps);
    if (summary.sent + summary.fallbacks + summary.checked + summary.late + summary.failed > 0) deps.logger.info('wake sweep', { ...summary });
    return json(summary);
  } catch (error) {
    deps.logger.error('wake sweep failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo revisar quién se ha despertado.');
  }
}
