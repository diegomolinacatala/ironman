/**
 * HTTP layer of `POST /briefing` `{ date, refresh? }` → `200 Briefing`:
 * user JWT (verified in code) → body → cached row when present and not
 * `refresh` (works without any AI provider) → 503 without an AI provider →
 * 403 consent_required → 429 after 12 generations in 24 h (atomic reservation in
 * `ai_usage` before the model call; failed calls count) → generate.
 * Errors `{ error, message }`: 401, 400, 403, 429, 503 ai_unavailable (also when the free
 * Workers AI allocation of the day is used up), 500.
 */
import { reserveAiCall } from '../ai/gate.ts';
import type { AiGate } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import { addDays, isIsoDate } from '../dates.ts';
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import { errorInfo } from '../log.ts';
import { dateSchema } from '../planning/changes.ts';
import { boolean, object, optional } from '../schema.ts';
import type { Result } from '../schema.ts';
import type { ISODate, UUID } from '../types.ts';
import { toBriefing } from './ports.ts';
import { BRIEFING_FUNCTION, generateBriefing } from './service.ts';
import type { BriefingDeps } from './service.ts';

export const BRIEFING_DAILY_LIMIT = 12;
/** Briefings can be generated for dates within ±2 days of the server's UTC date (today/tomorrow in any zone). */
export const BRIEFING_WINDOW_DAYS = 2;

export const BRIEFING_CONSENT_MESSAGE =
  'Para preparar tu informe con IA tienes que aceptar que enviemos tus datos de entrenamiento y sueño a la IA del coach (Cloudflare Workers AI). Mientras tanto te enseño el informe automático.';
export const BRIEFING_UNAVAILABLE_MESSAGE = 'El informe con IA no está disponible ahora mismo. Te enseño el informe automático.';

const GATE: AiGate = {
  functionName: BRIEFING_FUNCTION,
  limit: BRIEFING_DAILY_LIMIT,
  consentMessage: BRIEFING_CONSENT_MESSAGE,
  limitedMessage: `Has preparado el informe ${BRIEFING_DAILY_LIMIT} veces en las últimas 24 h. Vuelve a intentarlo más tarde.`,
};

export interface BriefingHttpDeps extends Omit<BriefingDeps, 'claude'> {
  claude: BriefingDeps['claude'] | null;
  /** Verifies the caller's JWT and returns the user id (null → 401). */
  authenticate: (req: Request) => Promise<UUID | null>;
}

export interface BriefingRequest {
  date: ISODate;
  refresh: boolean;
}

const bodySchema = object({ date: dateSchema(), refresh: optional(boolean()) }, undefined, { stripUnknown: true });

export function parseBriefingRequest(input: unknown): Result<BriefingRequest> {
  const parsed = bodySchema.parse(input, '');
  if (!parsed.ok) return parsed;
  if (!isIsoDate(parsed.value.date)) return { ok: false, error: `date: la fecha ${parsed.value.date} no existe` };
  return { ok: true, value: { date: parsed.value.date, refresh: parsed.value.refresh === true } };
}

function inWindow(date: ISODate, now: Date): boolean {
  const utcToday = now.toISOString().slice(0, 10);
  return date >= addDays(utcToday, -BRIEFING_WINDOW_DAYS) && date <= addDays(utcToday, BRIEFING_WINDOW_DAYS);
}

async function route(req: Request, deps: BriefingHttpDeps): Promise<Response> {
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para ver tu informe.');
  const parsed = parseBriefingRequest(await readJson(req, 4 * 1024));
  if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  const { date, refresh } = parsed.value;
  if (!refresh) {
    const cached = await deps.briefings.getBriefing(userId, date);
    if (cached) return json(toBriefing(cached));
  }
  if (!deps.claude) return errorResponse(503, 'ai_unavailable', 'El informe con IA no está configurado en el servidor. Te enseño el informe automático.');
  if (!inWindow(date, deps.now())) return errorResponse(400, 'bad_request', 'Solo puedo preparar el informe de hoy o de mañana.');
  const access = await reserveAiCall(deps.usage, userId, GATE);
  if (!access.ok) return access.response;
  return json(await generateBriefing({ ...deps, claude: deps.claude }, userId, date, access.usageId));
}

export async function handleBriefingHttp(req: Request, deps: BriefingHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  try {
    return await route(req, deps);
  } catch (error) {
    const bodyError = bodyErrorResponse(error);
    if (bodyError) return bodyError;
    if (error instanceof CoachAiError) {
      deps.logger.warn('briefing ai failed', { code: error.code });
      // The free tier's daily limit gets its own message; the app shows its local briefing either way.
      return errorResponse(503, 'ai_unavailable', error.code === 'quota' ? error.message : BRIEFING_UNAVAILABLE_MESSAGE);
    }
    deps.logger.error('briefing request failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo preparar tu informe. Inténtalo de nuevo.');
  }
}
