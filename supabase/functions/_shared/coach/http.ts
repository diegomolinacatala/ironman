/**
 * HTTP layer of `POST /coach`: 503 when no API key (before creating a job),
 * user auth, request validation, AI consent (403 `consent_required` while
 * `profiles.ai_consent_at` is null), atomic 30 jobs/24 h reservation
 * (`svc_reserve_coach_job`, 429 when full), then 202 `{ jobId }` while the
 * job runs in the background.
 */
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { UUID } from '../types.ts';
import type { CoachJob } from './job.ts';
import type { CoachStore } from './ports.ts';
import { parseCoachRequest } from './request.ts';

export const COACH_DAILY_LIMIT = 30;

export const CONSENT_REQUIRED_MESSAGE =
  'Para usar el coach con IA tienes que aceptar que enviemos tus datos de entrenamiento a Anthropic (Claude). Mientras tanto te propongo el plan automático.';

export interface CoachHttpDeps {
  aiConfigured: boolean;
  /** Verifies the caller's JWT and returns the user id (null → 401). */
  authenticate: (req: Request) => Promise<UUID | null>;
  store: Pick<CoachStore, 'getAiConsentAt' | 'reserveJob'>;
  /** Schedules the job in the background (EdgeRuntime.waitUntil in production). */
  startJob: (job: CoachJob) => void;
  logger: Logger;
}

export async function handleCoachHttp(req: Request, deps: CoachHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  if (!deps.aiConfigured) {
    return errorResponse(503, 'ai_unavailable', 'El coach con IA no está configurado en el servidor. Usa el plan automático.');
  }
  try {
    const userId = await deps.authenticate(req);
    if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para usar el coach.');
    const parsed = parseCoachRequest(await readJson(req, 128 * 1024));
    if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
    if (!(await deps.store.getAiConsentAt(userId))) return errorResponse(403, 'consent_required', CONSENT_REQUIRED_MESSAGE);
    const jobId = await deps.store.reserveJob(userId, parsed.value, COACH_DAILY_LIMIT);
    if (!jobId) {
      return errorResponse(429, 'rate_limited', `Has usado el coach con IA ${COACH_DAILY_LIMIT} veces en las últimas 24 h. Vuelve a intentarlo más tarde o usa el plan automático.`);
    }
    deps.startJob({ jobId, userId, request: parsed.value });
    deps.logger.info('coach job queued', { jobId, mode: parsed.value.mode });
    return json({ jobId }, 202);
  } catch (error) {
    const bodyError = bodyErrorResponse(error);
    if (bodyError) return bodyError;
    deps.logger.error('coach request failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo iniciar el coach. Inténtalo de nuevo.');
  }
}
