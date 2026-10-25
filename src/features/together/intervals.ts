/**
 * Time helpers for the Juntos area: my busy intervals (calendar blocks cut per
 * local day + timed workouts) and default training windows.
 *
 * Intervals are emitted as LOCAL date-times without offset
 * ("2026-10-26T18:30:00") so they are unambiguous for the domain functions,
 * whether they parse with `Date` or slice the string.
 */
import { daysInRange, minutesToTime, timeToMinutes, toLocalDateTime } from '@/domain/dates';
import type {
  BusyBlock,
  DateRange,
  ISODate,
  ISOTime,
  TrainingWindow,
  Weekday,
  Workout,
} from '@/domain/types';

import type { BusySegment, Interval } from './types';

export const MIN_SLOT_MINUTES = 45;
const DAY_MINUTES = 24 * 60;
const LAST_MINUTE = DAY_MINUTES - 1;
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Friends' windows are unknown to us: assume a reasonable training day. */
export const DEFAULT_WINDOW = { start: '06:30', end: '22:00' } as const;
export const DEFAULT_FRIEND_WINDOWS: readonly TrainingWindow[] = WEEKDAYS.map((weekday) => ({
  weekday,
  start: DEFAULT_WINDOW.start,
  end: DEFAULT_WINDOW.end,
}));

/** My windows from availability, or the default day when none are configured. */
export function windowsOrDefault(windows: readonly TrainingWindow[] | undefined | null): TrainingWindow[] {
  return windows && windows.length > 0 ? [...windows] : [...DEFAULT_FRIEND_WINDOWS];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Adds minutes to a wall-clock time, clamped to 23:59 (no day wrap). */
export function addMinutes(time: ISOTime, minutes: number): ISOTime {
  const total = Math.min(LAST_MINUTE, Math.max(0, timeToMinutes(time) + Math.round(minutes)));
  return minutesToTime(total);
}

export function timeRange(start: ISOTime, end: ISOTime): string {
  return `${start}–${end}`;
}

/** End time of a timed workout (null when it has no start time). */
export function workoutEnd(workout: Pick<Workout, 'startTime' | 'durationMin'>): ISOTime | null {
  return workout.startTime ? addMinutes(workout.startTime, workout.durationMin) : null;
}

/** Workouts that occupy the calendar: timed, not skipped, not rest days. */
export function isTimedActive(workout: Workout): workout is Workout & { startTime: ISOTime } {
  return Boolean(workout.startTime) && workout.status !== 'skipped' && workout.sport !== 'rest' && workout.durationMin > 0;
}

function localMidnight(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function clockOf(date: Date): ISOTime {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function segmentsOfBlock(block: BusyBlock, days: readonly ISODate[]): BusySegment[] {
  const start = new Date(block.start);
  const end = new Date(block.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];
  return days.flatMap((date) => {
    const dayStart = localMidnight(date);
    const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
    const segStart = start > dayStart ? start : dayStart;
    const segEnd = end < dayEnd ? end : dayEnd;
    if (segEnd <= segStart) return [];
    return [
      {
        key: `${block.id}:${date}`,
        date,
        start: clockOf(segStart),
        end: segEnd >= dayEnd ? minutesToTime(LAST_MINUTE) : clockOf(segEnd),
        title: block.title,
      },
    ];
  });
}

/** Busy blocks cut into per-day local segments inside `range`. */
export function busySegments(blocks: readonly BusyBlock[], range: DateRange): BusySegment[] {
  const days = daysInRange(range);
  return blocks.flatMap((block) => segmentsOfBlock(block, days));
}

/** My busy time for slot finding: calendar segments + timed workouts. */
export function myBusyIntervals(segments: readonly BusySegment[], workouts: readonly Workout[]): Interval[] {
  const fromBusy = segments.map((s) => ({ start: toLocalDateTime(s.date, s.start), end: toLocalDateTime(s.date, s.end) }));
  const fromWorkouts = workouts.filter(isTimedActive).map((w) => ({
    start: toLocalDateTime(w.date, w.startTime),
    end: toLocalDateTime(w.date, addMinutes(w.startTime, w.durationMin)),
  }));
  return [...fromBusy, ...fromWorkouts];
}
