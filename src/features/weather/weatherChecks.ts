/**
 * When the app looks at the weather and whether it may propose something (pure).
 *
 * - Weekly: the first open on Monday, or on Sunday from 18:00 (then for the
 *   week that starts the next day): the coming 7 days.
 * - Daily: the first open of each day: today.
 * - At most one weather proposal per day, never twice the same one (same
 *   sessions and outcome = same signature) whatever the athlete did with it,
 *   and never about a session that a pending weather proposal already covers.
 * - A daily proposal still pending the next day is out of date (its session
 *   day has gone): the app closes it, and its signature may come back. A weekly
 *   one is closed after a week.
 * Weather proposals are ordinary proposals (kind 'replan' or, from "Planificar
 * semana", 'generate_week'; source 'rules') marked with
 * `model = 'weather:<day|week|plan>:<signature>'`.
 */
import { addDays, toISODate, weekdayOf } from '@/domain/dates';
import type { ISODate, PlanProposal } from '@/domain/types';

export const WEATHER_MODEL_PREFIX = 'weather:';
/** Sunday from this hour looks at the week that starts the next day. */
export const SUNDAY_EVENING_MIN = 18 * 60;
const WEEK_DAYS = 7;

export type WeatherProposalScope = 'day' | 'week' | 'plan';

export function weatherModel(scope: WeatherProposalScope, signature: string): string {
  return `${WEATHER_MODEL_PREFIX}${scope}:${signature}`;
}

export function isWeatherProposal(p: Pick<PlanProposal, 'model'>): boolean {
  return typeof p.model === 'string' && p.model.startsWith(WEATHER_MODEL_PREFIX);
}

/** A proposal that only exists because of the weather (not a planned week that took it into account). */
export function isWeatherOnlyProposal(p: Pick<PlanProposal, 'model' | 'kind'>): boolean {
  return isWeatherProposal(p) && p.kind === 'replan';
}

function parts(p: Pick<PlanProposal, 'model'>): { scope: string; signature: string } {
  const [, scope = '', signature = ''] = (p.model ?? '').split(':');
  return { scope, signature };
}

export interface WeatherCheckState {
  /** Last day the daily check ran. */
  daily: ISODate | null;
  /** Monday of the last week the weekly check looked at. */
  weeklyFor: ISODate | null;
  /** Signatures of out-of-date proposals the app closed itself (not refused by the athlete). */
  expired: string[];
}

export const EMPTY_CHECK_STATE: WeatherCheckState = { daily: null, weeklyFor: null, expired: [] };

export type DueCheck = { scope: 'week'; from: ISODate; monday: ISODate } | { scope: 'day'; from: ISODate } | null;

/** The check to run now (the weekly one covers today too), or null. */
export function dueCheck(today: ISODate, nowMinutes: number, state: WeatherCheckState): DueCheck {
  const weekday = weekdayOf(today);
  if (weekday === 0 && state.weeklyFor !== today) return { scope: 'week', from: today, monday: today };
  const nextMonday = addDays(today, 1);
  if (weekday === 6 && nowMinutes >= SUNDAY_EVENING_MIN && state.weeklyFor !== nextMonday) return { scope: 'week', from: nextMonday, monday: nextMonday };
  return state.daily === today ? null : { scope: 'day', from: today };
}

/** State after running `check` (the daily check is done when the window includes today). */
export function afterCheck(state: WeatherCheckState, check: NonNullable<DueCheck>, today: ISODate, expired: readonly string[] = []): WeatherCheckState {
  const daily = check.from === today ? today : state.daily;
  const weeklyFor = check.scope === 'week' ? check.monday : state.weeklyFor;
  return { daily, weeklyFor, expired: [...new Set([...state.expired, ...expired])].slice(-50) };
}

const createdOn = (p: PlanProposal): ISODate => toISODate(new Date(p.createdAt));

/** Pending weather proposals that are out of date: a daily one from a previous day, any after a week. */
export function staleWeatherProposals(proposals: readonly PlanProposal[], today: ISODate): PlanProposal[] {
  return proposals.filter((p) => {
    if (!isWeatherProposal(p) || p.status !== 'pending') return false;
    const day = createdOn(p);
    return (parts(p).scope === 'day' && day < today) || day <= addDays(today, -WEEK_DAYS);
  });
}

export function signatureOfProposal(p: Pick<PlanProposal, 'model'>): string {
  return parts(p).signature;
}

/** Sessions a pending weather proposal already covers (left out of new ones). */
export function coveredWorkoutIds(proposals: readonly PlanProposal[]): string[] {
  return proposals
    .filter((p) => isWeatherProposal(p) && p.status === 'pending')
    .flatMap((p) => p.changes.flatMap((c) => (c.op === 'add' ? [] : [c.workoutId])));
}

/**
 * Whether a weather proposal with `signature` may be created today: none created today
 * already, and none with the same signature (except the out-of-date ones the app closed itself).
 */
export function mayPropose(proposals: readonly PlanProposal[], signature: string, today: ISODate, state: WeatherCheckState): boolean {
  if (!signature) return false;
  const weather = proposals.filter(isWeatherProposal);
  if (weather.some((p) => createdOn(p) === today)) return false;
  return !weather.some((p) => signatureOfProposal(p) === signature && !(p.status === 'discarded' && state.expired.includes(signature)));
}
