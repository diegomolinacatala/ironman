/**
 * Pure model behind the two-lane week compare (me | friend) and "Huecos".
 */
import { addDays, daysInRange, startOfWeek, timeToMinutes, toISODate, weekdayOf } from '@/domain/dates';
import type { CalendarVisibility, DateRange, FriendWeekItem, ISODate, Workout } from '@/domain/types';

import { addMinutes, MIN_SLOT_MINUTES, workoutEnd } from './intervals';
import type { BusySegment, CompareDay, LaneEntry, Slot } from './types';

const SLOT_ROUND_MIN = 15;
const SUNDAY = 6;
const UNTIMED_SORT = 24 * 60 + 1;

function sortMinutes(entry: LaneEntry): number {
  return entry.startTime ? timeToMinutes(entry.startTime) : UNTIMED_SORT;
}

function byTime(a: LaneEntry, b: LaneEntry): number {
  return sortMinutes(a) - sortMinutes(b) || a.key.localeCompare(b.key);
}

export function workoutEntry(workout: Workout): LaneEntry {
  return {
    key: `w:${workout.id}`,
    kind: 'workout',
    sport: workout.sport,
    title: workout.title,
    startTime: workout.startTime,
    endTime: workoutEnd(workout),
    durationMin: workout.durationMin,
    status: workout.status,
    isJoint: workout.jointSessionId !== null,
    workout,
  };
}

export function busyEntry(segment: BusySegment): LaneEntry {
  return {
    key: `b:${segment.key}`,
    kind: 'busy',
    sport: null,
    title: segment.title,
    startTime: segment.start,
    endTime: segment.end,
    durationMin: Math.max(0, timeToMinutes(segment.end) - timeToMinutes(segment.start)),
    status: null,
    isJoint: false,
    workout: null,
  };
}

export function friendEntry(item: FriendWeekItem, index: number): LaneEntry {
  const endTime =
    item.endTime ?? (item.startTime && item.durationMin ? addMinutes(item.startTime, item.durationMin) : null);
  return {
    key: `f:${item.id ?? `${item.date}-${index}`}:${item.kind}`,
    kind: item.kind,
    sport: item.sport,
    title: item.kind === 'busy' ? null : item.title,
    startTime: item.startTime,
    endTime,
    durationMin: item.durationMin,
    status: item.status,
    isJoint: item.jointSessionId !== null,
    workout: null,
  };
}

export interface CompareInput {
  range: DateRange;
  today: ISODate;
  myWorkouts: readonly Workout[];
  myBusy: readonly BusySegment[];
  friendItems: readonly FriendWeekItem[];
  slots: readonly Slot[];
}

interface DatedEntry {
  date: ISODate;
  entry: LaneEntry;
}

function entriesOn(entries: readonly DatedEntry[], date: ISODate): LaneEntry[] {
  return entries.filter((e) => e.date === date).map((e) => e.entry).sort(byTime);
}

/** One entry per day of `range` with both lanes sorted by start time. */
export function buildCompareDays(input: CompareInput): CompareDay[] {
  const mine: DatedEntry[] = [
    ...input.myWorkouts.map((w) => ({ date: w.date, entry: workoutEntry(w) })),
    ...input.myBusy.map((s) => ({ date: s.date, entry: busyEntry(s) })),
  ];
  const theirs: DatedEntry[] = input.friendItems.map((item, index) => ({ date: item.date, entry: friendEntry(item, index) }));
  return daysInRange(input.range).map((date) => ({
    date,
    isToday: date === input.today,
    isPast: date < input.today,
    mine: entriesOn(mine, date),
    theirs: entriesOn(theirs, date),
    slots: input.slots.filter((s) => s.date === date),
  }));
}

/**
 * Best guess of what the friend shares (the API does not expose it):
 * titled workouts → full, untitled workouts → summary, only busy → busy.
 */
export function inferVisibility(items: readonly FriendWeekItem[]): CalendarVisibility | null {
  const workouts = items.filter((i) => i.kind === 'workout');
  if (workouts.some((w) => w.title)) return 'full';
  if (workouts.length > 0) return 'summary';
  if (items.some((i) => i.kind === 'busy')) return 'busy';
  return null;
}

function roundUp(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step;
}

/** Drops past slots and trims today's ones so they start from now (rounded to 15'). */
export function futureSlots(slots: readonly Slot[], now: Date, minMinutes = MIN_SLOT_MINUTES): Slot[] {
  const today = toISODate(now);
  const nowMin = roundUp(now.getHours() * 60 + now.getMinutes(), SLOT_ROUND_MIN);
  return slots.flatMap((slot) => {
    if (slot.date < today) return [];
    if (slot.date > today) return [slot];
    const startMin = Math.max(timeToMinutes(slot.start), nowMin);
    const minutes = timeToMinutes(slot.end) - startMin;
    if (minutes < minMinutes) return [];
    const start = addMinutes('00:00', startMin);
    return [{ ...slot, start, minutes }];
  });
}

export function totalSlotMinutes(slots: readonly Slot[]): number {
  return slots.reduce((sum, s) => sum + s.minutes, 0);
}

/** Days (in order) that have at least one slot, with their slots. */
export function slotsByDay(slots: readonly Slot[]): { date: ISODate; slots: Slot[] }[] {
  const dates = [...new Set(slots.map((s) => s.date))].sort();
  return dates.map((date) => ({
    date,
    slots: slots.filter((s) => s.date === date).sort((a, b) => a.start.localeCompare(b.start)),
  }));
}

/** Week to compare by default: the current one, or next week on Sundays (this one is over). */
export function defaultCompareWeek(today: ISODate): ISODate {
  const current = startOfWeek(today);
  return weekdayOf(today) === SUNDAY ? addDays(current, 7) : current;
}
