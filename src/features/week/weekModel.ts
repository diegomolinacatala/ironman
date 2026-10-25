/** Pure helpers for the Semana screen (unit-tested). */
import type { BusyBlock, ISODate, LifeEvent, Workout } from '@/domain/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_PER_DAY = 24 * 60;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  return m === MINUTES_PER_DAY ? '24:00' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export interface DayInterval {
  start: number;
  end: number;
}

/** Portion of each busy block that falls on `date` (local time), merged and sorted. */
export function busyIntervalsOn(blocks: readonly BusyBlock[], date: ISODate): DayInterval[] {
  const raw = blocks.flatMap((b): DayInterval[] => {
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
    const startDate = localDate(start);
    const endDate = localDate(end);
    if (date < startDate || date > endDate) return [];
    const from = startDate === date ? localMinutes(start) : 0;
    const to = endDate === date ? localMinutes(end) : MINUTES_PER_DAY;
    return to > from ? [{ start: from, end: to }] : [];
  });
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  return sorted.reduce<DayInterval[]>((acc, cur) => {
    const last = acc[acc.length - 1];
    if (last && cur.start <= last.end) {
      return [...acc.slice(0, -1), { start: last.start, end: Math.max(last.end, cur.end) }];
    }
    return [...acc, cur];
  }, []);
}

/** "Ocupado 09:00–14:00 · 17:00–19:00" or null when the day is free. */
export function busySummary(blocks: readonly BusyBlock[], date: ISODate, maxRanges = 2): string | null {
  const intervals = busyIntervalsOn(blocks, date);
  if (intervals.length === 0) return null;
  if (intervals.some((i) => i.start === 0 && i.end === MINUTES_PER_DAY)) return 'Ocupado todo el día';
  const shown = intervals.slice(0, maxRanges).map((i) => `${hhmm(i.start)}–${hhmm(i.end)}`);
  const more = intervals.length > maxRanges ? ` +${intervals.length - maxRanges}` : '';
  return `Ocupado ${shown.join(' · ')}${more}`;
}

/** Life events active on a date (inclusive range). */
export function eventsOn(events: readonly LifeEvent[], date: ISODate): LifeEvent[] {
  return events.filter((e) => e.startDate <= date && date <= (e.endDate || e.startDate));
}

/** Workouts of a date, timed first. */
export function workoutsOnDay(workouts: readonly Workout[], date: ISODate): Workout[] {
  return workouts
    .filter((w) => w.date === date)
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

/** Completed minutes per week for the `weeks` weeks before `weekStart` (oldest first). */
export function recentWeeklyMinutes(workouts: readonly Workout[], weekStart: ISODate, weeks: number, addDays: (d: ISODate, n: number) => ISODate): number[] {
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(weekStart, -7 * (weeks - i));
    const to = addDays(from, 6);
    return workouts
      .filter((w) => w.status === 'completed' && w.date >= from && w.date <= to)
      .reduce((sum, w) => sum + (w.completed?.durationMin ?? w.durationMin), 0);
  });
}

/** Validates the `?week=` param; anything invalid falls back to `fallback`. */
export function parseWeekParam(value: unknown, fallback: ISODate): ISODate {
  return typeof value === 'string' && DATE_RE.test(value) ? value : fallback;
}

/** Hours with one decimal and a comma: 6.5 → "6,5". */
export function hoursLabel(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return String(h).replace('.', ',');
}
