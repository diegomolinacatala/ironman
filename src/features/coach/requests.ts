/**
 * Builds `CoachRequest`s from quick actions and route params (pure).
 */
import { addDays, startOfWeek } from '@/domain/dates';
import type { CoachMode, CoachRequest, ISODate } from '@/domain/types';
import type { IconName } from '@/ui';

import type { ChatHint } from './chatModel';

/** A coach request plus the text shown as the user's bubble. */
export interface PreparedRequest {
  request: CoachRequest;
  text: string;
  /** Suggested next step if the rules engine answers without changes. */
  followUp?: ChatHint;
}

export type QuickActionId = 'plan_week' | 'plan_next_week' | 'replan' | 'tired' | 'short_time' | 'fuel_long';

export interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: IconName;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'plan_week', label: 'Planifica mi semana', icon: 'week' },
  { id: 'plan_next_week', label: 'Planifica la semana que viene', icon: 'calendarBadge' },
  { id: 'replan', label: 'Reorganiza mi semana', icon: 'move' },
  { id: 'tired', label: 'Estoy cansado/a', icon: 'moon' },
  { id: 'short_time', label: 'Tengo poco tiempo esta semana', icon: 'clock' },
  { id: 'fuel_long', label: '¿Qué como antes del fondo largo?', icon: 'food' },
];

/** Longest message the composer accepts (also applied to route params). */
export const MAX_MESSAGE_LENGTH = 1000;

const MODES: readonly CoachMode[] = ['plan_week', 'replan', 'chat'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ActionSpec {
  mode: CoachMode;
  weekOffset: 0 | 1;
  message: string;
  followUp?: ChatHint;
}

const ACTION_SPECS: Record<QuickActionId, ActionSpec> = {
  plan_week: { mode: 'plan_week', weekOffset: 0, message: 'Planifica mi semana' },
  plan_next_week: { mode: 'plan_week', weekOffset: 1, message: 'Planifica la semana que viene' },
  replan: { mode: 'replan', weekOffset: 0, message: 'Reorganiza mi semana con lo que me queda' },
  tired: {
    mode: 'replan',
    weekOffset: 0,
    message: 'Estoy cansado/a: ajusta la semana para recuperar sin perder las sesiones clave',
    followUp: 'checkin',
  },
  short_time: {
    mode: 'replan',
    weekOffset: 0,
    message: 'Tengo poco tiempo esta semana: recorta el volumen y quédate con lo importante',
    followUp: 'log_event',
  },
  fuel_long: {
    mode: 'chat',
    weekOffset: 0,
    message: '¿Qué como antes del fondo largo de esta semana?',
  },
};

export function quickActionRequest(id: QuickActionId, today: ISODate): PreparedRequest {
  const spec = ACTION_SPECS[id];
  const label = QUICK_ACTIONS.find((a) => a.id === id)?.label ?? spec.message;
  return {
    request: { mode: spec.mode, weekStart: addDays(startOfWeek(today), spec.weekOffset * 7), message: spec.message },
    text: label,
    ...(spec.followUp ? { followUp: spec.followUp } : {}),
  };
}

export function chatRequest(message: string, today: ISODate): PreparedRequest {
  const text = message.trim();
  return { request: { mode: 'chat', weekStart: startOfWeek(today), message: text }, text };
}

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
 * Turns `/coach?mode&weekStart&lifeEventId&message` into a request the coach
 * screen PREFILLS (route params can come from any external link, so they are
 * never sent without a tap). Returns null when the params do not ask for anything.
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

/** Stable key of a prepared request (the same route params are offered once per visit). */
export function requestKey(prepared: PreparedRequest): string {
  const r = prepared.request;
  return [r.mode, r.weekStart, r.lifeEventId ?? '', r.message ?? ''].join('|');
}
