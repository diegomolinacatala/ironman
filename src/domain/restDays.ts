/**
 * Rest-day decisions of the weekly planner (L05, §10.3 S10):
 * - the explicit rest day, else a day the athlete already marked as rest
 *   ('rest' workout), else (≤ 12 h or beginner) the least free non-long day;
 * - a race never sits on the rest day: the rest moves to D+1, or to the least
 *   free day without a pinned pre-race session;
 * - with no rest day (> 12 h, not beginner) one easy day of ≤ 60' (L05 alternative).
 */
import { EASY_DAY_MAX_MIN } from './constants';
import { addDays, weekdayOf } from './dates';
import { mergeRestrictions, NO_RESTRICTION } from './restrictions';
import type { ISODate, Profile, Weekday } from './types';
import type { DayState } from './weekModel';

export interface RestDayInput {
  profile: Profile;
  /** Week model before the rest day is applied. */
  days: readonly DayState[];
  /** Weekly target in hours (L05 threshold). */
  hours: number;
  longDays: readonly Weekday[];
  /** Dates holding a non-skipped 'rest' workout of the athlete. */
  ownRestDates: readonly ISODate[];
  /** Race dates of the week. */
  raceDates: readonly ISODate[];
  /** Dates reserved by pinned sessions (race, activation, pre-race swim…). */
  pinnedDates: readonly ISODate[];
}

export interface RestDayPlan {
  days: DayState[];
  /** Rest weekday shown in the summary (null = none). */
  restDay: Weekday | null;
  /** The usual rest day falls on a race: rest moved to another day. */
  movedForRace: boolean;
  /** L05 easy day (≤ 60') when there is no rest day. */
  easyDay: Weekday | null;
}

function capacity(d: DayState): number {
  return d.free.reduce((s, r) => s + (r.end - r.start), 0);
}

function leastFree(days: readonly DayState[]): DayState | undefined {
  return [...days].sort((a, b) => capacity(a) - capacity(b) || a.weekday - b.weekday)[0];
}

/** Explicit rest day, the athlete's own rest workout, or (≤ 12 h or beginner, L05) the least free plannable non-long day. */
export function resolveRestDay(input: RestDayInput): Weekday | null {
  const explicit = input.profile.availability.restDay;
  if (explicit !== null && explicit !== undefined) return explicit;
  const own = [...input.ownRestDates].sort()[0];
  if (own) return weekdayOf(own);
  if (input.hours > 12 && input.profile.level !== 'beginner') return null;
  const candidates = input.days.filter((d) => d.plannable && !input.longDays.includes(d.weekday) && !input.pinnedDates.includes(d.date));
  const best = leastFree(candidates);
  return best ? best.weekday : 0;
}

/** Rest weekday after moving it off a race date (null when no day can take it). */
function relocateForRace(input: RestDayInput, restDay: Weekday): { restDay: Weekday | null; moved: boolean } {
  const restDate = input.days.find((d) => d.weekday === restDay)?.date;
  if (!restDate || !input.raceDates.includes(restDate)) return { restDay, moved: false };
  const free = (d: DayState) => d.plannable && !input.pinnedDates.includes(d.date) && !input.raceDates.includes(d.date);
  const dayAfter = input.days.find((d) => d.date === addDays(restDate, 1) && free(d));
  if (dayAfter) return { restDay: dayAfter.weekday, moved: true };
  const best = leastFree(input.days.filter(free));
  return { restDay: best ? best.weekday : null, moved: true };
}

function fixedHard(d: DayState): number {
  return d.fixed.reduce((s, f) => s + f.hardPoints, 0);
}

function fixedMinutes(d: DayState): number {
  return d.fixed.reduce((s, f) => s + f.durationMin, 0);
}

/** L05 alternative: the least free plannable non-long day without hard or long fixed sessions. */
function easyDayFor(input: RestDayInput): DayState | undefined {
  const candidates = input.days.filter(
    (d) => d.plannable && !input.longDays.includes(d.weekday) && !input.pinnedDates.includes(d.date) && fixedHard(d) === 0 && fixedMinutes(d) <= EASY_DAY_MAX_MIN,
  );
  return leastFree(candidates);
}

function asEasyDay(d: DayState): DayState {
  const easy = { ...NO_RESTRICTION, maxIntensity: 'endurance' as const, noQuality: true, noLong: true, codes: ['L05_EASY_DAY'] };
  return { ...d, dayCapMin: EASY_DAY_MAX_MIN, restriction: mergeRestrictions(d.restriction, easy) };
}

function asRestDay(d: DayState): DayState {
  return { ...d, plannable: false, isRestDay: true };
}

/** Applies the rest day, the athlete's own rest days and, without a rest day, the L05 easy day. */
export function planRestDays(input: RestDayInput): RestDayPlan {
  const resolved = resolveRestDay(input);
  const { restDay, moved } = resolved === null ? { restDay: null, moved: false } : relocateForRace(input, resolved);
  const isRest = (d: DayState) => (restDay !== null && d.weekday === restDay) || input.ownRestDates.includes(d.date);
  const withRest = input.days.map((d) => (isRest(d) ? asRestDay(d) : d));
  if (resolved !== null) return { days: withRest, restDay, movedForRace: moved, easyDay: null };
  const easy = easyDayFor({ ...input, days: withRest });
  const days = easy ? withRest.map((d) => (d.date === easy.date ? asEasyDay(d) : d)) : withRest;
  return { days, restDay: null, movedForRace: false, easyDay: easy ? easy.weekday : null };
}
