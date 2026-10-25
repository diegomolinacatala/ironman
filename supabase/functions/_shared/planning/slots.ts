/**
 * "Huecos" (common free slots) and "Oportunidades" (same sport, same day)
 * between the athlete and a friend. Works on local wall-clock minutes per date.
 */
import { localParts, minutesToTime, timeToMinutes, weekdayOf } from '../dates.ts';
import type { BusyBlock, FriendWeekItem, ISODate, Sport, TrainingWindow, UUID, Workout } from '../types.ts';

export interface DayInterval {
  date: ISODate;
  startMin: number;
  endMin: number;
}

export interface Slot {
  date: ISODate;
  start: string;
  end: string;
  minutes: number;
}

const DAY_START = 6 * 60;
const DAY_END = 22 * 60;

/** Busy blocks (split per local day) + timed workouts of the athlete. */
export function myBusyIntervals(busy: readonly BusyBlock[], workouts: readonly Workout[], tz: string): DayInterval[] {
  const fromBlocks = busy.map((b) => {
    const s = localParts(b.start, tz);
    const e = localParts(b.end, tz);
    return { date: s.date, startMin: timeToMinutes(s.time), endMin: e.date === s.date ? timeToMinutes(e.time) : 24 * 60 };
  });
  const fromWorkouts = workouts
    .filter((w) => w.startTime && w.status !== 'skipped' && w.sport !== 'rest')
    .map((w) => {
      const start = timeToMinutes(w.startTime as string);
      return { date: w.date, startMin: start, endMin: Math.min(24 * 60, start + w.durationMin) };
    });
  return [...fromBlocks, ...fromWorkouts];
}

/** Friend items already masked server-side; untimed events block the whole day. */
export function friendBusyIntervals(items: readonly FriendWeekItem[]): DayInterval[] {
  return items.flatMap((item): DayInterval[] => {
    if (!item.startTime) return item.kind === 'event' ? [{ date: item.date, startMin: 0, endMin: 24 * 60 }] : [];
    const start = timeToMinutes(item.startTime);
    const end = item.endTime ? timeToMinutes(item.endTime) : start + (item.durationMin ?? 60);
    return [{ date: item.date, startMin: start, endMin: Math.min(24 * 60, Math.max(end, start)) }];
  });
}

function subtract(base: [number, number][], busy: readonly [number, number][]): [number, number][] {
  return busy.reduce<[number, number][]>(
    (free, [bs, be]) =>
      free.flatMap(([fs, fe]): [number, number][] => {
        if (be <= fs || bs >= fe) return [[fs, fe]];
        const parts: [number, number][] = [];
        if (bs > fs) parts.push([fs, bs]);
        if (be < fe) parts.push([be, fe]);
        return parts;
      }),
    base,
  );
}

export interface CommonSlotsInput {
  dates: readonly ISODate[];
  busy: readonly DayInterval[];
  /** The athlete's usual training windows; empty = 06:00–22:00 every day. */
  windows: readonly TrainingWindow[];
  minMinutes: number;
  bufferMin?: number;
}

export function commonSlots(input: CommonSlotsInput): Slot[] {
  const buffer = input.bufferMin ?? 15;
  return input.dates.flatMap((date) => {
    const dayWindows = input.windows.filter((w) => w.weekday === weekdayOf(date));
    const base: [number, number][] = dayWindows.length
      ? dayWindows.map((w) => [timeToMinutes(w.start), timeToMinutes(w.end)])
      : [[DAY_START, DAY_END]];
    const busy = input.busy
      .filter((b) => b.date === date)
      .map((b): [number, number] => [b.startMin - buffer, b.endMin + buffer]);
    return subtract(base, busy)
      .filter(([s, e]) => e - s >= input.minMinutes)
      .map(([s, e]) => ({ date, start: minutesToTime(s), end: minutesToTime(e), minutes: e - s }));
  });
}

export interface Opportunity {
  date: ISODate;
  sport: Sport;
  myWorkoutId: UUID;
  myTitle: string;
  myStartTime: string | null;
  friendStartTime: string | null;
  friendTitle: string | null;
  friendDurationMin: number | null;
}

/** Same sport on the same day (planned on both sides). */
export function sameSportDays(mine: readonly Workout[], friendItems: readonly FriendWeekItem[]): Opportunity[] {
  return mine
    .filter((w) => w.status === 'planned' && w.sport !== 'rest' && !w.jointSessionId)
    .flatMap((w) =>
      friendItems
        .filter((f) => f.kind === 'workout' && f.date === w.date && f.status !== 'completed' && sportsMatch(w.sport, f.sport))
        .map((f) => ({
          date: w.date,
          sport: w.sport,
          myWorkoutId: w.id,
          myTitle: w.title,
          myStartTime: w.startTime,
          friendStartTime: f.startTime,
          friendTitle: f.title,
          friendDurationMin: f.durationMin,
        })),
    );
}

function sportsMatch(a: Sport, b: Sport | null): boolean {
  if (!b) return false;
  if (a === b) return true;
  const brickish = (s: Sport): boolean => s === 'brick' || s === 'bike' || s === 'run';
  return (a === 'brick' || b === 'brick') && brickish(a) && brickish(b);
}
