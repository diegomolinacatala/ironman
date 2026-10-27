/**
 * Generation of the morning briefing: optional Garmin refresh (when connected
 * and the last sync is older than 30 min; failures ignored) → context → Claude
 * (effort low, structured output) → validated text → `briefings` upsert. The
 * returned `sleep` is the snapshot computed here, never the model's reading.
 */
import { assertCompleted, callClaude, completeUsage, jsonObject } from '../ai/gate.ts';
import { withDeadline } from '../coach/deadline.ts';
import type { AiUsageStore, ClaudePort } from '../coach/ports.ts';
import type { GarminCredential } from '../garmin/credentials.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { Briefing, ISODate, UUID } from '../types.ts';
import { buildBriefingContext, promptPayload } from './context.ts';
import type { BriefingReader } from './context.ts';
import { BRIEFING_OUTPUT_JSON_SCHEMA, parseBriefingOutput } from './output.ts';
import { toBriefing } from './ports.ts';
import type { BriefingStore, GarminRefresher } from './ports.ts';
import { BRIEFING_SYSTEM_PROMPT } from './prompt.ts';

export const BRIEFING_FUNCTION = 'briefing';
export const BRIEFING_MAX_TOKENS = 4000;
export const GARMIN_STALE_MS = 30 * 60_000;
export const GARMIN_REFRESH_TIMEOUT_MS = 25_000;
export const BRIEFING_CLAUDE_TIMEOUT_MS = 90_000;

export interface BriefingDeps {
  reader: BriefingReader;
  briefings: BriefingStore;
  usage: AiUsageStore;
  claude: ClaudePort;
  /** Null when Garmin is not configured on the server (no GARMIN_KEY_SECRET). */
  garmin: GarminRefresher | null;
  now: () => Date;
  logger: Logger;
  garminTimeoutMs?: number;
  claudeTimeoutMs?: number;
}

/** Connected (or retrying after an error) and not synced in the last 30 min. */
export function shouldRefreshGarmin(c: GarminCredential | null, now: Date): c is GarminCredential {
  if (!c || (c.state !== 'connected' && c.state !== 'error')) return false;
  if (!c.lastSyncAt) return true;
  const last = Date.parse(c.lastSyncAt);
  return !Number.isFinite(last) || now.getTime() - last > GARMIN_STALE_MS;
}

/** Best effort: never throws, bounded in time. Returns what happened (for logs and tests). */
export async function refreshGarminIfStale(deps: BriefingDeps, userId: UUID): Promise<'skipped' | 'synced' | 'failed'> {
  if (!deps.garmin) return 'skipped';
  try {
    const credential = await deps.garmin.getCredential(userId);
    if (!shouldRefreshGarmin(credential, deps.now())) return 'skipped';
    const outcome = await withDeadline(deps.garmin.sync(credential), AbortSignal.timeout(deps.garminTimeoutMs ?? GARMIN_REFRESH_TIMEOUT_MS));
    if (!outcome.ok) deps.logger.info('briefing garmin refresh not ok', { code: outcome.code });
    return outcome.ok ? 'synced' : 'failed';
  } catch (error) {
    deps.logger.warn('briefing garmin refresh failed', errorInfo(error));
    return 'failed';
  }
}

function userMessage(payload: Record<string, unknown>): string {
  return `Prepara el informe de la mañana del ${String(payload.date)} (${String(payload.weekday)}).\n\nContexto del atleta (JSON):\n${JSON.stringify(payload)}`;
}

/**
 * Generates, stores and returns the briefing of `date`. `usageId` is the `ai_usage` row reserved
 * before calling (it gets the model/tokens afterwards). Throws CoachAiError for AI failures.
 */
export async function generateBriefing(deps: BriefingDeps, userId: UUID, date: ISODate, usageId: number): Promise<Briefing> {
  const garmin = await refreshGarminIfStale(deps, userId);
  const context = await buildBriefingContext(deps.reader, { userId, date, now: deps.now() });
  const response = await callClaude(
    deps.claude,
    {
      userId,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage(promptPayload(context)) }],
      effort: 'low',
      schema: BRIEFING_OUTPUT_JSON_SCHEMA,
      maxTokens: BRIEFING_MAX_TOKENS,
    },
    deps.claudeTimeoutMs ?? BRIEFING_CLAUDE_TIMEOUT_MS,
  );
  await completeUsage(deps.usage, userId, usageId, response, deps.logger);
  assertCompleted(response);
  const text = parseBriefingOutput(jsonObject(response.text), context.sleep !== null);
  const stored = await deps.briefings.upsertBriefing(userId, {
    date,
    ...text,
    sleep: context.sleep,
    model: response.model,
    createdAt: deps.now().toISOString(),
  });
  deps.logger.info('briefing generated', { garmin, model: response.model, fallback: response.fallbackUsed === true, hasSleep: context.sleep !== null });
  return toBriefing(stored);
}
