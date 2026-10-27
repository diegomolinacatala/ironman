/**
 * Calls an AI edge function (`briefing`, `meal`) and sorts the outcome into
 * "use the response", "fall back to the local engine" (AI unavailable, no
 * consent, rate limited, not deployed, 5xx, timeout) or a thrown
 * RepositoryError (session expired, offline, bad input).
 */
import { logger } from '@/lib/logger';

import { RepositoryError, type RepositoryErrorCode } from '../repository';
import type { SupabaseCtx } from './base';
import { MESSAGES, fromHttpStatus, functionErrorInfo, isNetworkError } from './errors';
import { asString, isRecord } from './narrow';

export type AiFunctionResult = { kind: 'ok'; data: unknown } | { kind: 'fallback'; reason: string };

export interface AiFunctionCall {
  name: 'briefing' | 'meal';
  body: Record<string, unknown>;
  timeoutMs: number;
  /** Message for errors we cannot describe better. */
  fallbackMessage: string;
  /** Specific errors by HTTP status (e.g. 413 → "La foto es demasiado grande"). */
  statusErrors?: Readonly<Record<number, { code: RepositoryErrorCode; message: string }>>;
}

/** Error codes of the AI functions that mean "use the local engine". */
const FALLBACK_CODES: readonly string[] = ['ai_unavailable', 'consent_required', 'rate_limited', 'internal'];
/** 404 = function not deployed yet; 429/5xx = temporary. */
const FALLBACK_STATUSES: readonly number[] = [404, 408, 429];
/** Grace on top of the fetch timeout, in case the platform fetch ignores the abort signal. */
const DEADLINE_GRACE_MS = 2_000;
const TIMED_OUT = Symbol('timed-out');

function isAbortError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const context = isRecord(error.context) ? error.context : null;
  if (context && (context.name === 'AbortError' || context.name === 'TimeoutError')) return true;
  const message = asString(context?.message) ?? asString(error.message) ?? '';
  return error.name === 'FunctionsFetchError' && /abort/i.test(message);
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function classifyError(call: AiFunctionCall, error: unknown): Promise<AiFunctionResult> {
  if (isAbortError(error)) return { kind: 'fallback', reason: 'timeout' };
  if (isRecord(error) && error.name === 'FunctionsRelayError') return { kind: 'fallback', reason: 'relay' };
  if (isNetworkError(error)) throw new RepositoryError('network', MESSAGES.network, error);
  const info = await functionErrorInfo(error);
  logger.warn(`${call.name} function failed`, { status: info.status, error: info.errorCode });
  if (info.status === 401) throw new RepositoryError('not_authenticated', MESSAGES.notAuthenticated, error);
  if (info.status === null) return { kind: 'fallback', reason: 'unknown' };
  const specific = call.statusErrors?.[info.status];
  if (specific) throw new RepositoryError(specific.code, specific.message, error);
  if (info.errorCode && FALLBACK_CODES.includes(info.errorCode)) return { kind: 'fallback', reason: info.errorCode };
  if (FALLBACK_STATUSES.includes(info.status) || info.status >= 500) return { kind: 'fallback', reason: `http_${info.status}` };
  throw fromHttpStatus(info.status, call.fallbackMessage, error, info.message);
}

export async function invokeAiFunction(ctx: SupabaseCtx, call: AiFunctionCall): Promise<AiFunctionResult> {
  let response: { data: unknown; error: unknown } | typeof TIMED_OUT;
  try {
    response = await withDeadline(
      ctx.client.functions.invoke(call.name, { body: call.body, timeout: call.timeoutMs }),
      call.timeoutMs + DEADLINE_GRACE_MS,
    );
  } catch (error) {
    return classifyError(call, error);
  }
  if (response === TIMED_OUT) return { kind: 'fallback', reason: 'timeout' };
  if (response.error) return classifyError(call, response.error);
  return { kind: 'ok', data: response.data };
}
