/**
 * `POST /analysis` `{ workoutId, date, refresh? }` → `200 WorkoutAnalysis`.
 * User JWT verified in code. Returns the stored analysis when there is one
 * (no AI call); otherwise: completed session only, consent, 30 analyses / 24 h
 * (atomic `ai_usage` reservation, function 'analysis'), one structured AI call,
 * upsert into `workout_analyses`. Errors `{ error, message }`: 401, 400,
 * 404 not_found, 403 consent_required, 429 rate_limited, 503 ai_unavailable, 500.
 */
import { assertCompleted, callClaude, completeUsage, jsonObject, reserveAiCall } from '../ai/gate.ts';
import type { AiGate } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { AiUsageStore, ClaudePort } from '../coach/ports.ts';
import { addDays } from '../dates.ts';
import { BodyError, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { dateSchema, uuidSchema } from '../planning/changes.ts';
import type { PlanningReader } from '../planning/store.ts';
import { boolean, object, optional } from '../schema.ts';
import type { ISODate, UUID, WorkoutAnalysis } from '../types.ts';
import { analysisMessage } from './context.ts';
import { ANALYSIS_OUTPUT_JSON_SCHEMA, toWorkoutAnalysis } from './output.ts';
import { ANALYSIS_SYSTEM_PROMPT } from './prompt.ts';

export const ANALYSIS_FUNCTION = 'analysis';
export const ANALYSIS_DAILY_LIMIT = 30;
export const ANALYSIS_MAX_TOKENS = 3000;
export const ANALYSIS_TIMEOUT_MS = 45_000;

export const ANALYSIS_CONSENT_MESSAGE =
  'Para analizar tus entrenos con IA tienes que aceptar que enviemos tus datos de entrenamiento a la IA del coach (Cloudflare Workers AI).';
export const ANALYSIS_UNAVAILABLE_MESSAGE = 'No he podido analizar la sesión ahora mismo. Inténtalo en un rato.';

const GATE: AiGate = {
  functionName: ANALYSIS_FUNCTION,
  limit: ANALYSIS_DAILY_LIMIT,
  consentMessage: ANALYSIS_CONSENT_MESSAGE,
  limitedMessage: `Has pedido ${ANALYSIS_DAILY_LIMIT} análisis en las últimas 24 h. Vuelve a intentarlo más tarde.`,
};

export interface AnalysisStore {
  getAnalysis(userId: UUID, workoutId: UUID): Promise<WorkoutAnalysis | null>;
  upsertAnalysis(userId: UUID, analysis: WorkoutAnalysis, model: string | null): Promise<WorkoutAnalysis>;
}

export interface AnalysisHttpDeps {
  authenticate: (req: Request) => Promise<UUID | null>;
  reader: Pick<PlanningReader, 'getProfile' | 'listWorkouts' | 'listCheckins' | 'listRaces'>;
  analyses: AnalysisStore;
  usage: AiUsageStore;
  claude: ClaudePort | null;
  now: () => Date;
  logger: Logger;
  claudeTimeoutMs?: number;
}

interface AnalysisRequest {
  workoutId: UUID;
  date: ISODate;
  refresh: boolean;
}

const bodySchema = object({ workoutId: uuidSchema(), date: dateSchema(), refresh: optional(boolean()) }, undefined, { stripUnknown: true });

async function analyze(deps: AnalysisHttpDeps & { claude: ClaudePort }, userId: UUID, request: AnalysisRequest): Promise<Response> {
  const [workouts, profile] = await Promise.all([
    deps.reader.listWorkouts(userId, addDays(request.date, -6), addDays(request.date, 1)),
    deps.reader.getProfile(userId),
  ]);
  const workout = workouts.find((w) => w.id === request.workoutId);
  if (!workout || !profile) return errorResponse(404, 'not_found', 'No encuentro ese entreno.');
  if (workout.status !== 'completed') return errorResponse(400, 'bad_request', 'Solo se pueden analizar sesiones hechas.');
  const access = await reserveAiCall(deps.usage, userId, GATE);
  if (!access.ok) return access.response;
  const [checkins, races] = await Promise.all([deps.reader.listCheckins(userId, workout.date, workout.date), deps.reader.listRaces(userId)]);
  const response = await callClaude(
    deps.claude,
    {
      userId,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: analysisMessage({ workout, profile, races, workouts, checkin: checkins[0] ?? null }) }] }],
      effort: 'low',
      schema: ANALYSIS_OUTPUT_JSON_SCHEMA,
      maxTokens: ANALYSIS_MAX_TOKENS,
    },
    deps.claudeTimeoutMs ?? ANALYSIS_TIMEOUT_MS,
  );
  await completeUsage(deps.usage, userId, access.usageId, response, deps.logger);
  assertCompleted(response);
  const analysis = toWorkoutAnalysis(jsonObject(response.text), workout.id, deps.now().toISOString());
  const saved = await deps.analyses.upsertAnalysis(userId, analysis, response.model);
  deps.logger.info('workout analyzed', { sport: workout.sport, model: response.model });
  return json(saved);
}

async function route(req: Request, deps: AnalysisHttpDeps): Promise<Response> {
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para analizar el entreno.');
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    if (error instanceof BodyError) return errorResponse(error.status, error.code, error.message);
    throw error;
  }
  const parsed = bodySchema.parse(body, '');
  if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  const request: AnalysisRequest = { workoutId: parsed.value.workoutId, date: parsed.value.date, refresh: parsed.value.refresh === true };
  if (!request.refresh) {
    const stored = await deps.analyses.getAnalysis(userId, request.workoutId);
    if (stored) return json(stored);
  }
  if (!deps.claude) return errorResponse(503, 'ai_unavailable', 'El análisis con IA no está configurado en el servidor.');
  return analyze({ ...deps, claude: deps.claude }, userId, request);
}

export async function handleAnalysisHttp(req: Request, deps: AnalysisHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  try {
    return await route(req, deps);
  } catch (error) {
    if (error instanceof CoachAiError) {
      deps.logger.warn('analysis ai failed', { code: error.code });
      return errorResponse(503, 'ai_unavailable', error.code === 'quota' ? error.message : ANALYSIS_UNAVAILABLE_MESSAGE);
    }
    deps.logger.error('analysis request failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo analizar el entreno. Inténtalo de nuevo.');
  }
}
