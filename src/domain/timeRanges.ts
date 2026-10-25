/**
 * Minute-of-day range algebra shared by the planner (start-time picking) and
 * "Huecos" (common free slots). Ranges are half-open [start, end) in minutes
 * since local midnight.
 */
import { addDays, dateTimeParts, minutesToTime, timeToMinutes, weekdayOf } from './dates';
import type { ISODate, ISODateTime, ISOTime, TrainingWindow } from './types';

export interface MinuteRange {
  start: number;
  end: number;
}

export interface DateTimeInterval {
  start: ISODateTime;
  end: ISODateTime;
}

export const DAY_MINUTES = 24 * 60;
export const DEFAULT_DAY_START: ISOTime = '07:00';
export const DEFAULT_DAY_END: ISOTime = '22:00';

function clampMinutes(n: number): number {
  return Math.min(Math.max(n, 0), DAY_MINUTES);
}

/** Sorted, merged, non-empty ranges. */
export function mergeRanges(ranges: readonly MinuteRange[]): MinuteRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.reduce<MinuteRange[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.start <= last.end) return [...acc.slice(0, -1), { start: last.start, end: Math.max(last.end, r.end) }];
    return [...acc, { start: r.start, end: r.end }];
  }, []);
}

/** base − minus. */
export function subtractRanges(base: readonly MinuteRange[], minus: readonly MinuteRange[]): MinuteRange[] {
  const holes = mergeRanges(minus);
  return mergeRanges(base).flatMap((range) => {
    let pieces: MinuteRange[] = [range];
    for (const hole of holes) {
      pieces = pieces.flatMap((p) => {
        if (hole.end <= p.start || hole.start >= p.end) return [p];
        return [
          { start: p.start, end: Math.max(p.start, hole.start) },
          { start: Math.min(p.end, hole.end), end: p.end },
        ].filter((x) => x.end > x.start);
      });
    }
    return pieces;
  });
}

/** a ∩ b. */
export function intersectRanges(a: readonly MinuteRange[], b: readonly MinuteRange[]): MinuteRange[] {
  const left = mergeRanges(a);
  const right = mergeRanges(b);
  const out: MinuteRange[] = [];
  for (const x of left) {
    for (const y of right) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeRanges(out);
}

export function rangesLength(ranges: readonly MinuteRange[]): number {
  return mergeRanges(ranges).reduce((s, r) => s + (r.end - r.start), 0);
}

/** Part of a timestamp interval that falls on `date`, expanded by `bufferMin`. */
export function intervalOnDate(interval: DateTimeInterval, date: ISODate, bufferMin = 0): MinuteRange | null {
  const start = dateTimeParts(interval.start);
  const end = dateTimeParts(interval.end);
  if (!start || !end) return null;
  if (end.date < date || start.date > date) return null;
  const s = start.date < date ? 0 : start.minutes;
  const e = end.date > date ? DAY_MINUTES : end.minutes;
  if (e <= s) return null;
  return { start: clampMinutes(s - bufferMin), end: clampMinutes(e + bufferMin) };
}

export function busyRangesOn(date: ISODate, busy: readonly DateTimeInterval[], bufferMin = 0): MinuteRange[] {
  return mergeRanges(busy.map((b) => intervalOnDate(b, date, bufferMin)).filter((r): r is MinuteRange => r !== null));
}

/** Training windows of that weekday; if none are set for it, the whole default day. */
export function windowRangesOn(
  date: ISODate,
  windows: readonly TrainingWindow[],
  dayStart: ISOTime = DEFAULT_DAY_START,
  dayEnd: ISOTime = DEFAULT_DAY_END,
): { ranges: MinuteRange[]; isDefault: boolean } {
  const weekday = weekdayOf(date);
  const own = windows
    .filter((w) => w.weekday === weekday)
    .map((w) => ({ start: timeToMinutes(w.start), end: timeToMinutes(w.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  if (own.length > 0) return { ranges: mergeRanges(own), isDefault: false };
  const start = timeToMinutes(dayStart);
  const end = timeToMinutes(dayEnd);
  const safeStart = Number.isFinite(start) ? start : timeToMinutes(DEFAULT_DAY_START);
  const safeEnd = Number.isFinite(end) && end > safeStart ? end : timeToMinutes(DEFAULT_DAY_END);
  return { ranges: [{ start: safeStart, end: safeEnd }], isDefault: true };
}

/** Local interval for a timed item lasting `durationMin` (may end the next day). */
export function localInterval(date: ISODate, startTime: ISOTime, durationMin: number): DateTimeInterval | null {
  const start = timeToMinutes(startTime);
  if (!Number.isFinite(start) || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  const endAbs = start + Math.round(durationMin);
  const endDate = endAbs >= DAY_MINUTES ? addDays(date, Math.floor(endAbs / DAY_MINUTES)) : date;
  const endMinutes = endAbs % DAY_MINUTES;
  return {
    start: `${date}T${minutesToTime(start)}:00`,
    end: `${endDate}T${minutesToTime(endMinutes)}:00`,
  };
}
