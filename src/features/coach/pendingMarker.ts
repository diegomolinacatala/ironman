/**
 * The "a coach request is in flight" marker, persisted with the conversation
 * so leaving and reopening the coach (or the app) neither loses the answer nor
 * starts a duplicate AI job (pure; storage is untrusted input).
 */
import type { CoachMessage, CoachMode, CoachRequest, ISODateTime, PlanProposal } from '@/domain/types';

import { parseHint, type ChatHint } from './chatModel';

export interface PendingMarker {
  request: CoachRequest;
  followUp: ChatHint | null;
  startedAt: ISODateTime;
}

/** The data layer polls the AI job for ~170 s: past this a restored marker is stale. */
export const PENDING_TIMEOUT_MS = 180_000;
/** Tolerated clock difference between the phone and the server when matching proposals. */
export const CLOCK_SKEW_MS = 30_000;

const MODES: readonly CoachMode[] = ['plan_week', 'replan', 'chat'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHistoryTurns(value: unknown): CoachMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((turn): CoachMessage[] => {
    if (!isRecord(turn) || typeof turn.content !== 'string') return [];
    return turn.role === 'user' || turn.role === 'assistant' ? [{ role: turn.role, content: turn.content }] : [];
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Defensive parse of a persisted `CoachRequest`. */
export function parseCoachRequest(value: unknown): CoachRequest | null {
  if (!isRecord(value)) return null;
  const { mode, weekStart } = value;
  if (typeof mode !== 'string' || !MODES.includes(mode as CoachMode)) return null;
  if (typeof weekStart !== 'string' || !DATE_RE.test(weekStart)) return null;
  const message = optionalString(value.message);
  const lifeEventId = optionalString(value.lifeEventId);
  const history = parseHistoryTurns(value.history);
  const friendIds = Array.isArray(value.friendIds)
    ? value.friendIds.filter((id): id is string => typeof id === 'string')
    : undefined;
  return {
    mode: mode as CoachMode,
    weekStart,
    ...(message ? { message } : {}),
    ...(lifeEventId ? { lifeEventId } : {}),
    ...(history ? { history } : {}),
    ...(friendIds ? { friendIds } : {}),
  };
}

export function parsePendingMarker(value: unknown): PendingMarker | null {
  if (!isRecord(value)) return null;
  const request = parseCoachRequest(value.request);
  const { startedAt } = value;
  if (!request || typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) return null;
  return { request, followUp: parseHint(value.followUp), startedAt };
}

export function pendingMarker(request: CoachRequest, followUp: ChatHint | null, now: Date): PendingMarker {
  return { request, followUp, startedAt: now.toISOString() };
}

/** Milliseconds left before a restored marker counts as stale (0 when already stale). */
export function pendingRemainingMs(startedAt: ISODateTime, now: Date, timeoutMs: number = PENDING_TIMEOUT_MS): number {
  const elapsed = now.getTime() - Date.parse(startedAt);
  return Math.max(0, timeoutMs - elapsed);
}

/**
 * The coach proposal that answers a restored marker: created by the AI coach
 * (or the rules fallback) after the request started.
 */
export function findAnsweredProposal(marker: PendingMarker, proposals: readonly PlanProposal[]): PlanProposal | null {
  const since = Date.parse(marker.startedAt) - CLOCK_SKEW_MS;
  const candidates = proposals
    .filter((p) => p.source !== 'claude' && Date.parse(p.createdAt) >= since)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return candidates[0] ?? null;
}
