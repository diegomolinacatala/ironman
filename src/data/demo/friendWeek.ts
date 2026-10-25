/**
 * Friend calendar masking — mirrors `private.friend_week_items` (SQL):
 * - full: workouts (with titles) + shareable life events (with titles) + busy blocks.
 * - summary: same without any title.
 * - busy: only 'busy' intervals (busy blocks, timed workouts, timed shareable
 *   events, travel days).
 * Busy-block titles are NEVER returned; health/work/exam/other life events are
 * never shared. Intervals are split per day (device timezone ≈ the friend's
 * Europe/Madrid), ending at '23:59' when they run past midnight.
 */
import { addDays, daysInRange, maxDate, minDate, minutesToTime, timeToMinutes } from '@/domain/dates';
import type {
  BusyBlock,
  CalendarVisibility,
  DateRange,
  FriendWeekItem,
  ISODate,
  LifeEvent,
  LifeEventKind,
  Workout,
} from '@/domain/types';

import { localIso } from './ids';

const SHAREABLE_EVENTS: readonly LifeEventKind[] = ['padel', 'football', 'other_sport', 'travel', 'social'];
const MINUTE_MS = 60_000;
const DAY_END_TIME = '23:59';

export interface FriendWeekInput {
  visibility: CalendarVisibility;
  range: DateRange;
  workouts: readonly Workout[];
  busyBlocks: readonly BusyBlock[];
  lifeEvents: readonly LifeEvent[];
}

interface Interval {
  start: number;
  end: number;
}

const EMPTY: Omit<FriendWeekItem, 'kind' | 'date'> = {
  id: null,
  startTime: null,
  endTime: null,
  durationMin: null,
  sport: null,
  intensity: null,
  title: null,
  status: null,
  jointSessionId: null,
};

function dayStartMs(date: ISODate): number {
  return Date.parse(localIso(date, '00:00'));
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return minutesToTime(d.getHours() * 60 + d.getMinutes());
}

function timedInterval(date: ISODate, startTime: string, durationMin: number): Interval {
  const start = Date.parse(localIso(date, startTime));
  return { start, end: start + durationMin * MINUTE_MS };
}

/** Splits an absolute interval into per-day busy items clipped to `range`. */
export function splitInterval(interval: Interval, range: DateRange): FriendWeekItem[] {
  return daysInRange(range).flatMap((date) => {
    const dayStart = dayStartMs(date);
    const dayEnd = dayStartMs(addDays(date, 1));
    if (!(interval.start < dayEnd && interval.end > dayStart)) return [];
    const from = Math.max(interval.start, dayStart);
    const to = Math.min(interval.end, dayEnd);
    return [
      {
        ...EMPTY,
        kind: 'busy' as const,
        date,
        startTime: hhmm(from),
        endTime: interval.end >= dayEnd ? DAY_END_TIME : hhmm(interval.end),
        durationMin: Math.round((to - from) / MINUTE_MS),
      },
    ];
  });
}

export function splitBusyBlock(block: Pick<BusyBlock, 'start' | 'end'>, range: DateRange): FriendWeekItem[] {
  const start = Date.parse(block.start);
  const end = Date.parse(block.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return splitInterval({ start, end }, range);
}

function endTimeOf(startTime: string | null, durationMin: number | null): string | null {
  if (!startTime || durationMin === null) return null;
  const end = timeToMinutes(startTime) + durationMin;
  return end < 24 * 60 ? minutesToTime(end) : DAY_END_TIME;
}

/** Busy-mode intervals derived from workouts and life events. */
function busyModeIntervals(input: FriendWeekInput): Interval[] {
  const { range } = input;
  const from = addDays(range.from, -1);
  const workouts = input.workouts
    .filter((w) => w.date >= from && w.date <= range.to && w.startTime && w.durationMin > 0 && w.status !== 'skipped')
    .map((w) => timedInterval(w.date, w.startTime ?? '00:00', w.durationMin));
  const shareable = input.lifeEvents.filter((e) => SHAREABLE_EVENTS.includes(e.kind));
  const timedEvents = shareable
    .filter((e) => e.startTime && (e.durationMin ?? 0) > 0 && e.startDate >= from && e.startDate <= range.to)
    .map((e) => timedInterval(e.startDate, e.startTime ?? '00:00', e.durationMin ?? 0));
  const travelDays = shareable
    .filter((e) => e.kind === 'travel' && !e.startTime && e.startDate <= range.to && e.endDate >= range.from)
    .flatMap((e) => daysInRange({ from: maxDate(e.startDate, range.from), to: minDate(e.endDate, range.to) }))
    .map((d) => ({ start: dayStartMs(d), end: dayStartMs(addDays(d, 1)) }));
  return [...workouts, ...timedEvents, ...travelDays];
}

function workoutItem(w: Workout, visibility: CalendarVisibility): FriendWeekItem {
  return {
    kind: 'workout',
    id: w.id,
    date: w.date,
    startTime: w.startTime,
    endTime: endTimeOf(w.startTime, w.durationMin),
    durationMin: w.durationMin,
    sport: w.sport,
    intensity: w.intensity,
    title: visibility === 'full' ? w.title : null,
    status: w.status,
    jointSessionId: w.jointSessionId,
  };
}

function eventItems(e: LifeEvent, range: DateRange, visibility: CalendarVisibility): FriendWeekItem[] {
  if (!SHAREABLE_EVENTS.includes(e.kind) || e.startDate > range.to || e.endDate < range.from) return [];
  return daysInRange({ from: maxDate(e.startDate, range.from), to: minDate(e.endDate, range.to) }).map((date) => {
    const isFirst = date === e.startDate;
    return {
      ...EMPTY,
      kind: 'event' as const,
      id: e.id,
      date,
      startTime: isFirst ? e.startTime : null,
      endTime: isFirst ? endTimeOf(e.startTime, e.durationMin) : null,
      durationMin: e.durationMin,
      title: visibility === 'full' ? e.title : null,
    };
  });
}

function compareItems(a: FriendWeekItem, b: FriendWeekItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const byStart = (a.startTime ?? '').localeCompare(b.startTime ?? '');
  return byStart !== 0 ? byStart : a.kind.localeCompare(b.kind);
}

export function maskFriendWeek(input: FriendWeekInput): FriendWeekItem[] {
  const { visibility, range } = input;
  const blocks = input.busyBlocks.flatMap((b) => splitBusyBlock(b, range));
  if (visibility === 'busy') {
    const derived = busyModeIntervals(input).flatMap((i) => splitInterval(i, range));
    return [...blocks, ...derived].sort(compareItems);
  }
  const workouts = input.workouts.filter((w) => w.date >= range.from && w.date <= range.to).map((w) => workoutItem(w, visibility));
  const events = input.lifeEvents.flatMap((e) => eventItems(e, range, visibility));
  return [...blocks, ...workouts, ...events].sort(compareItems);
}
