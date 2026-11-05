/**
 * HTTP layer of `POST /speech` `{ text, voice? }` → `200 { audio, mime, model, tier }`:
 * user JWT (verified in code) → body (text trimmed 1..600 chars, voice one of SPEECH_VOICES,
 * default 'nestor') → 503 without the worker → 403 consent_required → 429 rate_limited (per-user
 * 24 h limit; atomic `svc_reserve_speech`, which also picks the tier from the global premium budget
 * of the UTC day) → worker (15 s) → base64 audio. `Cache-Control: no-store`.
 * Errors `{ error, message }`: 401, 400, 405, 413, 403, 429, 503 ai_unavailable (any worker failure,
 * timeout or non-audio answer: the app then uses the on-device voice), 500. Never logs the text.
 */
import { plainText } from '../ai/gate.ts';
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { enumOf, object, optional, string } from '../schema.ts';
import type { Result } from '../schema.ts';
import type { UUID } from '../types.ts';
import { bytesToBase64 } from './audio.ts';
import { DEFAULT_SPEECH_VOICE, SPEECH_VOICES, SpeechUnavailableError } from './ports.ts';
import type { SpeechAudio, SpeechBudgetStore, SpeechLimits, SpeechPort, SpeechSynthesisRequest, SpeechTier, SpeechVoice } from './ports.ts';

export const SPEECH_MAX_CHARS = 600;
export const SPEECH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export const SPEECH_CONSENT_MESSAGE =
  'Para escuchar la voz natural del coach tienes que aceptar que enviemos el texto a la IA del coach (Cloudflare Workers AI). Mientras tanto uso la voz del iPhone.';
export const SPEECH_UNAVAILABLE_MESSAGE = 'La voz natural no está disponible ahora mismo. Uso la voz del iPhone.';
export const SPEECH_QUOTA_MESSAGE = 'La voz natural ha llegado a su límite de hoy. Uso la voz del iPhone hasta mañana.';
export const SPEECH_LIMITED_MESSAGE = 'Has usado mucho la voz natural en las últimas 24 h. Mientras tanto uso la voz del iPhone.';

export interface SpeechHttpDeps {
  /** Verifies the caller's JWT and returns the user id (null → 401). */
  authenticate: (req: Request) => Promise<UUID | null>;
  budget: SpeechBudgetStore;
  /** null when the worker is not configured (→ 503 ai_unavailable). */
  speech: SpeechPort | null;
  limits: SpeechLimits;
  logger: Logger;
  timeoutMs?: number;
}

export interface SpeechRequestBody {
  text: string;
  voice: SpeechVoice;
}

export interface SpeechResponseBody {
  /** Standard base64 of the audio bytes. */
  audio: string;
  mime: SpeechAudio['mime'];
  model: string;
  tier: SpeechTier;
}

const bodySchema = object(
  { text: string({ min: 1, max: SPEECH_MAX_CHARS }), voice: optional(enumOf(SPEECH_VOICES)) },
  undefined,
  { stripUnknown: true },
);

/** Validates the body; the text is cleaned for speech (no markdown, emoji or repeated spaces). */
export function parseSpeechRequest(input: unknown): Result<SpeechRequestBody> {
  const parsed = bodySchema.parse(input, '');
  if (!parsed.ok) return parsed;
  // The worker refuses control characters (tabs and line breaks are fine): they become spaces, then collapse.
  const text = plainText(parsed.value.text.replace(CONTROL_CHARS, ' '));
  if (!text) return { ok: false, error: 'text: no hay nada que leer' };
  return { ok: true, value: { text, voice: parsed.value.voice ?? DEFAULT_SPEECH_VOICE } };
}

/** Worker call bounded by `ms` (aborted and rejected with a timeout even if the port ignores the signal). */
async function synthesizeWithin(port: SpeechPort, request: Omit<SpeechSynthesisRequest, 'signal'>, ms: number): Promise<SpeechAudio> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SpeechUnavailableError('timeout', 'La voz ha tardado demasiado.'));
    }, ms);
  });
  try {
    return await Promise.race([port.synthesize({ ...request, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(error: unknown, tier: SpeechTier, logger: Logger): Response {
  const code = error instanceof SpeechUnavailableError ? error.code : 'unexpected';
  logger.warn('speech synthesis failed', { code, tier, ...(error instanceof SpeechUnavailableError ? {} : errorInfo(error)) });
  return errorResponse(503, 'ai_unavailable', code === 'quota' ? SPEECH_QUOTA_MESSAGE : SPEECH_UNAVAILABLE_MESSAGE);
}

async function route(req: Request, deps: SpeechHttpDeps): Promise<Response> {
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo para escuchar la voz del coach.');
  const parsed = parseSpeechRequest(await readJson(req, MAX_BODY_BYTES));
  if (!parsed.ok) return errorResponse(400, 'bad_request', `Petición no válida: ${parsed.error}`);
  if (!deps.speech) return errorResponse(503, 'ai_unavailable', SPEECH_UNAVAILABLE_MESSAGE);
  if (!(await deps.budget.getAiConsentAt(userId))) return errorResponse(403, 'consent_required', SPEECH_CONSENT_MESSAGE);
  const { text, voice } = parsed.value;
  const tier = await deps.budget.reserveSpeech(userId, text.length, deps.limits);
  if (!tier) return errorResponse(429, 'rate_limited', SPEECH_LIMITED_MESSAGE);

  let audio: SpeechAudio;
  try {
    audio = await synthesizeWithin(deps.speech, { userId, text, voice, tier }, deps.timeoutMs ?? SPEECH_TIMEOUT_MS);
  } catch (error) {
    return unavailable(error, tier, deps.logger);
  }
  deps.logger.info('speech synthesized', { tier, model: audio.model, chars: text.length, bytes: audio.bytes.length });
  const body: SpeechResponseBody = { audio: bytesToBase64(audio.bytes), mime: audio.mime, model: audio.model, tier };
  return json(body, 200, { 'Cache-Control': 'no-store' });
}

export async function handleSpeechHttp(req: Request, deps: SpeechHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  try {
    return await route(req, deps);
  } catch (error) {
    const bodyError = bodyErrorResponse(error);
    if (bodyError) return bodyError;
    deps.logger.error('speech request failed', errorInfo(error));
    return errorResponse(500, 'internal', 'No se pudo preparar la voz. Inténtalo de nuevo.');
  }
}
