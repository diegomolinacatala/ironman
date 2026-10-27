/**
 * Builds `CoachRequest`s from route params (pure). Route params can come from
 * any external link, so they only ever PREFILL the coach: nothing is sent
 * without a tap.
 */
import { startOfWeek } from '@/domain/dates';
import type { CoachMode, CoachRequest, ISODate } from '@/domain/types';

/** A coach request plus the text shown as the user's bubble. */
export interface PreparedRequest {
  request: CoachRequest;
  text: string;
}

/** Longest message the composer accepts (also applied to route params). */
export const MAX_MESSAGE_LENGTH = 1000;

const MODES: readonly CoachMode[] = ['plan_week', 'replan', 'chat'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function defaultText(mode: CoachMode, hasLifeEvent: boolean): string {
  if (hasLifeEvent) return 'Me ha surgido un imprevisto: reorganiza mi semana';
  if (mode === 'plan_week') return 'Planifica mi semana';
  if (mode === 'replan') return 'Reorganiza mi semana';
  return 'Hola, coach';
}

// A type alias (not an interface) so it satisfies expo-router's params constraint.
export type CoachRouteParams = {
  mode?: string | string[];
  weekStart?: string | string[];
  lifeEventId?: string | string[];
  message?: string | string[];
};

/**
 * Turns `?mode&weekStart&lifeEventId&message` into a request the coach
 * PREFILLS. Returns null when the params do not ask for anything.
 */
export function requestFromParams(params: CoachRouteParams, today: ISODate): PreparedRequest | null {
  const rawMode = firstParam(params.mode);
  const message = firstParam(params.message)?.slice(0, MAX_MESSAGE_LENGTH).trim();
  const lifeEventId = firstParam(params.lifeEventId);
  if (!rawMode && !message && !lifeEventId) return null;
  const mode: CoachMode =
    rawMode && MODES.includes(rawMode as CoachMode) ? (rawMode as CoachMode) : lifeEventId ? 'replan' : 'chat';
  const rawWeek = firstParam(params.weekStart);
  const weekStart = rawWeek && DATE_RE.test(rawWeek) ? startOfWeek(rawWeek) : startOfWeek(today);
  const request: CoachRequest = {
    mode,
    weekStart,
    ...(message ? { message } : {}),
    ...(lifeEventId ? { lifeEventId } : {}),
  };
  return { request, text: message ?? defaultText(mode, Boolean(lifeEventId)) };
}

/** `/coach?…` (v1 links) → `/talk?…` with the same, non-empty params. */
export function coachRedirectHref(params: CoachRouteParams): string {
  const query = (['mode', 'weekStart', 'lifeEventId', 'message'] as const)
    .map((key) => [key, firstParam(params[key])] as const)
    .filter((entry): entry is readonly [typeof entry[0], string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `/talk?${query}` : '/talk';
}
