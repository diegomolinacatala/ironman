/**
 * Shared plumbing of the synchronous AI functions (briefing, meal): consent and
 * the atomic 24 h `ai_usage` reservation, the bounded AI call, usage accounting and the
 * stop-reason / JSON checks on the answer. The coach keeps its own job flow.
 */
import { withDeadline } from '../coach/deadline.ts';
import { CoachAiError } from '../coach/ports.ts';
import type { AiUsageStore, ClaudePort, ClaudeRequest, ClaudeResponse } from '../coach/ports.ts';
import { errorResponse } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { UUID } from '../types.ts';

export interface AiGate {
  functionName: string;
  /** Calls allowed per user in the last 24 h (counted in `ai_usage`). */
  limit: number;
  consentMessage: string;
  limitedMessage: string;
}

export type AiAccess = { ok: true; usageId: number } | { ok: false; response: Response };

/**
 * 403 consent_required / 429 rate_limited, or a reserved `ai_usage` row. The reservation is
 * atomic (parallel requests cannot exceed the limit) and happens before the model call, so
 * failed calls stay counted. Store errors propagate (fail closed → 500).
 */
export async function reserveAiCall(store: AiUsageStore, userId: UUID, gate: AiGate): Promise<AiAccess> {
  if (!(await store.getAiConsentAt(userId))) return { ok: false, response: errorResponse(403, 'consent_required', gate.consentMessage) };
  const usageId = await store.reserveCall(userId, gate.functionName, gate.limit);
  return usageId === null ? { ok: false, response: errorResponse(429, 'rate_limited', gate.limitedMessage) } : { ok: true, usageId };
}

/** One Claude call bounded by `timeoutMs` (the stream is aborted and a timeout CoachAiError thrown). */
export function callClaude(claude: ClaudePort, request: Omit<ClaudeRequest, 'signal'>, timeoutMs: number): Promise<ClaudeResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  return withDeadline(claude.generate({ ...request, signal }), signal);
}

/** Fills model/tokens of the reserved row (best effort: the call is already counted). */
export async function completeUsage(store: AiUsageStore, userId: UUID, usageId: number, response: ClaudeResponse, logger: Logger): Promise<void> {
  try {
    await store.completeCall(userId, usageId, { model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens });
  } catch (error) {
    logger.warn('ai usage not completed', { usageId, ...errorInfo(error) });
  }
}

/** Throws for a refusal or a cut answer (both after the usage was recorded). */
export function assertCompleted(response: ClaudeResponse): void {
  if (response.stopReason === 'refusal') throw new CoachAiError('refusal', 'Claude no ha podido responder a esta petición.');
  if (response.stopReason === 'max_tokens') throw new CoachAiError('max_tokens', 'La respuesta de Claude se ha cortado.');
}

/** The model text as a JSON object, or a `bad_output` CoachAiError. */
export function jsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new CoachAiError('bad_output', 'La respuesta de Claude no tenía el formato esperado.');
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** Plain, single-line text for UI and speech: no markdown marks, bullets or emoji; collapsed spaces. */
export function plainText(value: string): string {
  return value
    .replace(EMOJI, '')
    .replace(/^\s*(?:[-*•>]|#{1,6}|\d+[.)])\s+/gm, '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuts at the last word boundary that fits, adding "…" when something was dropped. */
export function clipWords(value: string, max: number): string {
  if (value.length <= max) return value;
  const room = value.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  const cut = (space > max * 0.6 ? room.slice(0, space) : room).replace(/[\s,;:·.-]+$/, '');
  return `${cut}…`;
}

export function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
