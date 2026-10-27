/**
 * `POST /meal` `{ date, time, imageBase64?, text? }` → `200 MealAnalysis`
 * (`engine: 'ai'`). User JWT verified in code; consent; 40 analyses / 24 h
 * (atomic `ai_usage` reservation before the call, function 'meal'); vision model with effort low and a
 * structured output. Context sent: today's workouts only. Nothing is stored
 * except the usage row. Errors `{ error, message }`: 401, 400, 413 too_large,
 * 403 consent_required, 429 rate_limited, 503 ai_unavailable, 500 internal.
 */
import { assertCompleted, callClaude, completeUsage, jsonObject, reserveAiCall } from '../ai/gate.ts';
import type { AiGate } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { AiUsageStore, ClaudeContentBlock, ClaudePort } from '../coach/ports.ts';
import { BodyError, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { intensityLabel, sportLabel } from '../planning/labels.ts';
import type { PlanningReader } from '../planning/store.ts';
import type { MealAnalysis, UUID, Workout } from '../types.ts';
import { MEAL_OUTPUT_JSON_SCHEMA, mealSlotFromTime, toMealAnalysis } from './output.ts';
import { MEAL_SYSTEM_PROMPT } from './prompt.ts';
import { MAX_BODY_BYTES, parseMealRequest } from './request.ts';
import type { MealRequest } from './request.ts';

export const MEAL_FUNCTION = 'meal';
export const MEAL_DAILY_LIMIT = 40;
export const MEAL_MAX_TOKENS = 4000;
export const MEAL_CLAUDE_TIMEOUT_MS = 60_000;

export const MEAL_CONSENT_MESSAGE =
  'Para analizar tus comidas con IA tienes que aceptar que enviemos la foto y tus datos de entrenamiento a la IA del coach (Cloudflare Workers AI). Mientras tanto puedes apuntarla a mano.';
export const MEAL_UNAVAILABLE_MESSAGE = 'No he podido analizar la comida ahora mismo. Apúntala a mano o inténtalo en un rato.';
export const TOO_LARGE_MESSAGE = 'La foto es demasiado grande (máximo 2 MB). Prueba con otra o recórtala.';

const GATE: AiGate = {
  functionName: MEAL_FUNCTION,
  limit: MEAL_DAILY_LIMIT,
  consentMessage: MEAL_CONSENT_MESSAGE,
  limitedMessage: `Has analizado ${MEAL_DAILY_LIMIT} comidas en las últimas 24 h. Apunta esta a mano o vuelve a intentarlo más tarde.`,
};

const SLOT_LABELS: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', dinner: 'cena', snack: 'media mañana o merienda' };

export interface MealHttpDeps {
  authenticate: (req: Request) => Promise<UUID | null>;
  reader: Pick<PlanningReader, 'listWorkouts'>;
  usage: AiUsageStore;
  claude: ClaudePort | null;
  now: () => Date;
  logger: Logger;
  claudeTimeoutMs?: number;
}

function workoutForPrompt(w: Workout): Record<string, unknown> {
  return {
    title: w.title,
    sport: sportLabel(w.sport),
    startTime: w.startTime,
    durationMin: w.durationMin,
    intensity: intensityLabel(w.intensity),
    status: w.status,
  };
}

/** Image block first (vision best practice), then the instructions with the context. */
export function mealContent(request: MealRequest, workouts: readonly Workout[]): ClaudeContentBlock[] {
  const slot = SLOT_LABELS[mealSlotFromTime(request.time)] ?? 'comida';
  const lines = [
    `Comida del ${request.date} a las ${request.time} (franja probable por la hora: ${slot}).`,
    request.text ? `Lo que cuenta el atleta: "${request.text}"` : 'El atleta no ha añadido descripción.',
    request.image ? 'Analiza la foto.' : 'No hay foto: estima a partir de la descripción.',
    `Entrenos de hoy (JSON): ${JSON.stringify(workouts.map(workoutForPrompt))}`,
  ];
  const text: ClaudeContentBlock = { type: 'text', text: lines.join('\n') };
  return request.image ? [{ type: 'image', mediaType: request.image.mediaType, base64: request.image.base64 }, text] : [text];
}

async function analyze(deps: MealHttpDeps & { claude: ClaudePort }, userId: UUID, request: MealRequest, usageId: number): Promise<MealAnalysis> {
  const workouts = (await deps.reader.listWorkouts(userId, request.date, request.date)).sort((a, b) =>
    (a.startTime ?? '99').localeCompare(b.startTime ?? '99'),
  );
  const response = await callClaude(
    deps.claude,
    {
      userId,
      system: MEAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: mealContent(request, workouts) }],
      effort: 'low',
      schema: MEAL_OUTPUT_JSON_SCHEMA,
      maxTokens: MEAL_MAX_TOKENS,
    },
    deps.claudeTimeoutMs ?? MEAL_CLAUDE_TIMEOUT_MS,
  );
  await completeUsage(deps.usage, userId, usageId, response, deps.logger);
  assertCompleted(response);
  const analysis = toMealAnalysis(jsonObject(response.text), request.time);
  deps.logger.info('meal analyzed', { photo: request.image !== null, confidence: analysis.confidence, model: response.model });
  return analysis;
}

async function readBody(req: Request): Promise<unknown | Response> {
  try {
    return await readJson(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyError && error.status === 413) return errorResponse(413, 'too_large', TOO_LARGE_MESSAGE);
    if (error instanceof BodyError) return errorResponse(error.status, error.code, error.message);
    throw error;
  }
}

async function route(req: Request, deps: MealHttpDeps): Promise<Response> {
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para analizar la comida.');
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const parsed = parseMealRequest(body);
  if (!parsed.ok) {
    return parsed.status === 413
      ? errorResponse(413, 'too_large', TOO_LARGE_MESSAGE)
      : errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  }
  if (!deps.claude) return errorResponse(503, 'ai_unavailable', 'El análisis con IA no está configurado en el servidor. Apunta la comida a mano.');
  const access = await reserveAiCall(deps.usage, userId, GATE);
  if (!access.ok) return access.response;
  return json(await analyze({ ...deps, claude: deps.claude }, userId, parsed.value, access.usageId));
}

export async function handleMealHttp(req: Request, deps: MealHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  try {
    return await route(req, deps);
  } catch (error) {
    if (error instanceof CoachAiError) {
      deps.logger.warn('meal ai failed', { code: error.code });
      return errorResponse(503, 'ai_unavailable', error.code === 'quota' ? error.message : MEAL_UNAVAILABLE_MESSAGE);
    }
    deps.logger.error('meal request failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo analizar la comida. Inténtalo de nuevo.');
  }
}
