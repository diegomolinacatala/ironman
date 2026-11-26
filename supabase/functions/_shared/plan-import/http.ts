/**
 * `POST /plan-import` → `200 PlanImportResponse` (`engine: 'ai'`): reads an
 * external training plan with the free AI. User JWT verified in code; AI
 * consent; 20 reads / 24 h (atomic `ai_usage` reservation, function
 * 'plan_import'). Photos go to the vision model (Llama 4 Scout); pasted text
 * and PDFs to the text model (Qwen) — a PDF's text is extracted here first
 * (`PdfTextPort`, unpdf in the entry point). A PDF without text (a scan)
 * answers 422 `scanned_pdf` so the app asks for photos of the pages.
 * Nothing is stored except the usage row: the athlete reviews the plan in
 * the app and saves it with the `apply_plan_import` RPC.
 * Errors `{ error, message }`: 401, 400, 413 too_large, 422 scanned_pdf,
 * 403 consent_required, 429 rate_limited, 503 ai_unavailable, 500 internal.
 */
import { assertCompleted, callClaude, completeUsage, jsonObject, reserveAiCall } from '../ai/gate.ts';
import type { AiGate } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { AiUsageStore, ClaudeContentBlock, ClaudePort } from '../coach/ports.ts';
import { BodyError, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { UUID } from '../types.ts';
import { PLAN_OUTPUT_JSON_SCHEMA, toPlanImportResponse } from './output.ts';
import type { PlanImportResponse } from './output.ts';
import { PLAN_IMPORT_SYSTEM_PROMPT } from './prompt.ts';
import { MAX_BODY_BYTES, MAX_TEXT, parsePlanImportRequest } from './request.ts';
import type { PlanImportRequest } from './request.ts';

export const PLAN_IMPORT_FUNCTION = 'plan_import';
export const PLAN_IMPORT_DAILY_LIMIT = 20;
export const PLAN_IMPORT_MAX_TOKENS = 16_000;
export const PLAN_IMPORT_TIMEOUT_MS = 100_000;
/** Pages read from a PDF (a season plan rarely needs more). */
export const PDF_MAX_PAGES = 30;
/** Below this many letters a PDF is treated as a scan (images only). */
export const PDF_MIN_TEXT = 40;

export const PLAN_CONSENT_MESSAGE =
  'Para leer el plan con IA tienes que aceptar que enviemos el archivo a la IA del coach (Cloudflare Workers AI). Mientras tanto puedes importarlo desde un Excel o CSV.';
export const PLAN_UNAVAILABLE_MESSAGE = 'No he podido leer el plan ahora mismo. Inténtalo en un rato o importa un Excel o CSV.';
export const SCANNED_PDF_MESSAGE = 'Este PDF es una imagen escaneada y no tiene texto. Haz una foto o una captura de cada página y súbelas como foto.';
export const TOO_LARGE_MESSAGE = 'El archivo es demasiado grande (máximo 4,5 MB el PDF y 2 MB la foto).';

const GATE: AiGate = {
  functionName: PLAN_IMPORT_FUNCTION,
  limit: PLAN_IMPORT_DAILY_LIMIT,
  consentMessage: PLAN_CONSENT_MESSAGE,
  limitedMessage: `Has leído ${PLAN_IMPORT_DAILY_LIMIT} planes en las últimas 24 h. Vuelve a intentarlo más tarde o importa un Excel o CSV.`,
};

export interface PdfText {
  pages: number;
  text: string;
}

/** Text of a PDF (first `maxPages` pages, pages joined with blank lines). Throws on a broken file. */
export type PdfTextPort = (bytes: Uint8Array, maxPages: number) => Promise<PdfText>;

export interface PlanImportHttpDeps {
  authenticate: (req: Request) => Promise<UUID | null>;
  usage: AiUsageStore;
  /** Text model (pasted text, PDF text). */
  text: ClaudePort | null;
  /** Vision model (photos). */
  vision: ClaudePort | null;
  pdfText: PdfTextPort;
  logger: Logger;
  timeoutMs?: number;
}

class ScannedPdfError extends Error {}

export async function pdfToText(port: PdfTextPort, bytes: Uint8Array): Promise<string> {
  let result: PdfText;
  try {
    result = await port(bytes, PDF_MAX_PAGES);
  } catch {
    throw new BodyError(400, 'bad_request', 'No he podido abrir el PDF. Comprueba que no tenga contraseña o prueba con una foto.');
  }
  const text = result.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if ((text.match(/\p{L}/gu) ?? []).length < PDF_MIN_TEXT) throw new ScannedPdfError();
  return text.slice(0, MAX_TEXT);
}

export function planContent(request: { kind: 'text'; text: string } | { kind: 'image'; image: Extract<PlanImportRequest, { kind: 'image' }>['image'] }, origin: 'texto' | 'PDF'): ClaudeContentBlock[] {
  if (request.kind === 'image') {
    return [
      { type: 'image', mediaType: request.image.mediaType, base64: request.image.base64 },
      { type: 'text', text: 'Foto del plan de entrenamiento. Pásalo a la lista de sesiones.' },
    ];
  }
  return [{ type: 'text', text: `Plan de entrenamiento (${origin}):\n"""\n${request.text}\n"""\nPásalo a la lista de sesiones.` }];
}

type ReadableRequest = { kind: 'text'; text: string; origin: 'texto' | 'PDF' } | Extract<PlanImportRequest, { kind: 'image' }>;

async function read(deps: PlanImportHttpDeps & { port: ClaudePort }, userId: UUID, request: ReadableRequest, usageId: number): Promise<PlanImportResponse> {
  const content = request.kind === 'image' ? planContent(request, 'texto') : planContent(request, request.origin);
  const response = await callClaude(
    deps.port,
    {
      userId,
      system: PLAN_IMPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      effort: 'low',
      schema: PLAN_OUTPUT_JSON_SCHEMA,
      maxTokens: PLAN_IMPORT_MAX_TOKENS,
    },
    deps.timeoutMs ?? PLAN_IMPORT_TIMEOUT_MS,
  );
  await completeUsage(deps.usage, userId, usageId, response, deps.logger);
  assertCompleted(response);
  const plan = toPlanImportResponse(jsonObject(response.text));
  deps.logger.info('plan read', { kind: request.kind === 'image' ? 'image' : request.origin, sessions: plan.sessions.length, confidence: plan.confidence, model: response.model });
  return plan;
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

async function route(req: Request, deps: PlanImportHttpDeps): Promise<Response> {
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para importar el plan.');
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const parsed = parsePlanImportRequest(body);
  if (!parsed.ok) {
    return parsed.status === 413 ? errorResponse(413, 'too_large', TOO_LARGE_MESSAGE) : errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  }
  const value = parsed.value;
  const port = value.kind === 'image' ? deps.vision : deps.text;
  if (!port) return errorResponse(503, 'ai_unavailable', 'La lectura con IA no está configurada en el servidor. Importa un Excel o CSV.');
  // The PDF text is extracted before the usage reservation: a scan or a broken file costs nothing.
  const readable: ReadableRequest =
    value.kind === 'pdf' ? { kind: 'text', text: await pdfToText(deps.pdfText, value.pdf), origin: 'PDF' } : value.kind === 'text' ? { ...value, origin: 'texto' } : value;
  const access = await reserveAiCall(deps.usage, userId, GATE);
  if (!access.ok) return access.response;
  return json(await read({ ...deps, port }, userId, readable, access.usageId));
}

export async function handlePlanImportHttp(req: Request, deps: PlanImportHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  try {
    return await route(req, deps);
  } catch (error) {
    if (error instanceof ScannedPdfError) return errorResponse(422, 'scanned_pdf', SCANNED_PDF_MESSAGE);
    if (error instanceof BodyError) return errorResponse(error.status, error.code, error.message);
    if (error instanceof CoachAiError) {
      deps.logger.warn('plan import ai failed', { code: error.code });
      return errorResponse(503, 'ai_unavailable', error.code === 'quota' ? error.message : PLAN_UNAVAILABLE_MESSAGE);
    }
    deps.logger.error('plan import failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo leer el plan. Inténtalo de nuevo.');
  }
}
