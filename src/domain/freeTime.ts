/**
 * Free time of a day for the re-planner: the athlete's training windows (or
 * the default 07:00–22:00 day) minus calendar busy blocks, timed sessions and
 * the time taken by life events. Untimed events still take minutes of the day
 * (a work meeting or an errand "some time on Thursday").
 */
import { timeToMinutes } from './dates';
import { mergeRanges, rangesLength, type MinuteRange } from './timeRanges';
import type { ISODate, LifeEvent, LifeEventKind } from './types';

/** Minutes an event takes when the athlete did not give a duration (60–90 by kind). */
export const DEFAULT_EVENT_DURATION_MIN: Readonly<Record<LifeEventKind, number>> = {
  padel: 90,
  football: 90,
  other_sport: 75,
  social: 90,
  work: 90,
  exam: 90,
  travel: 90,
  other: 60,
  stress: 60,
  overload: 60,
  injury: 60,
  illness: 60,
};

/** Kinds that take time out of the day (stress, overload, injuries and illness do not). */
const TIME_TAKING: ReadonlySet<LifeEventKind> = new Set<LifeEventKind>([
  'padel',
  'football',
  'other_sport',
  'social',
  'work',
  'exam',
  'travel',
  'other',
]);

export function takesTime(e: Pick<LifeEvent, 'kind' | 'startTime'>): boolean {
  return Boolean(e.startTime) || TIME_TAKING.has(e.kind);
}

/** The event's duration, or the default of its kind. */
export function eventDurationMin(e: Pick<LifeEvent, 'kind' | 'durationMin'>): number {
  const d = e.durationMin;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : DEFAULT_EVENT_DURATION_MIN[e.kind];
}

function coversDate(e: Pick<LifeEvent, 'startDate' | 'endDate'>, date: ISODate): boolean {
  return e.startDate <= date && (e.endDate || e.startDate) >= date;
}

/** Minute range a timed event takes on `date` (every day of a multi-day event, same time), or null. */
export function eventRangeOn(e: LifeEvent, date: ISODate): MinuteRange | null {
  if (!e.startTime || !coversDate(e, date)) return null;
  const start = timeToMinutes(e.startTime);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + eventDurationMin(e) };
}

/** Ranges taken by timed events on `date`. */
export function eventRangesOn(events: readonly LifeEvent[], date: ISODate): MinuteRange[] {
  return mergeRanges(events.map((e) => eventRangeOn(e, date)).filter((r): r is MinuteRange => r !== null));
}

/** Minutes taken by untimed events on `date` (their exact time is unknown). */
export function untimedEventMinutesOn(events: readonly LifeEvent[], date: ISODate): number {
  return events.filter((e) => !e.startTime && TIME_TAKING.has(e.kind) && coversDate(e, date)).reduce((s, e) => s + eventDurationMin(e), 0);
}

/** Largest range of `free` at least `min` long (earliest on ties), or null. */
export function largestGap(free: readonly MinuteRange[], min: number): MinuteRange | null {
  return free.reduce<MinuteRange | null>((best, r) => {
    const len = r.end - r.start;
    if (len < min) return best;
    return !best || len > best.end - best.start ? r : best;
  }, null);
}

/**
 * Whether a session of `need` minutes (duration + margin) fits in `free`:
 * one gap long enough, and enough minutes left once `reservedMin` (untimed
 * events and other untimed sessions of the day) is taken.
 */
export function fitsInFreeTime(free: readonly MinuteRange[], need: number, reservedMin: number): boolean {
  return largestGap(free, need) !== null && rangesLength(free) - reservedMin >= need;
}
