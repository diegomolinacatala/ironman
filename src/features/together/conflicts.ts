/**
 * Conflict preview for a proposed quedada: what overlaps for me and for each
 * invited friend on that day. Pure; Spanish messages.
 */
import { timeToMinutes } from '@/domain/dates';
import type { FriendWeekItem, ISODate, ISOTime, Sport, UUID, Workout } from '@/domain/types';

import { addMinutes, timeRange, workoutEnd } from './intervals';
import type { BusySegment, LaneKind } from './types';

export interface DayEntry {
  kind: LaneKind;
  sport: Sport | null;
  title: string | null;
  start: ISOTime | null;
  end: ISOTime | null;
}

export interface ConflictReport {
  /** Timed entries overlapping the proposed time. */
  overlaps: DayEntry[];
  /** Untimed sessions that day (no overlap possible, but worth knowing). */
  sameDay: DayEntry[];
}

export function myDayEntries(
  date: ISODate,
  workouts: readonly Workout[],
  busy: readonly BusySegment[],
  excludeWorkoutId?: UUID | null,
): DayEntry[] {
  const fromWorkouts = workouts
    .filter((w) => w.date === date && w.id !== excludeWorkoutId && w.status !== 'skipped' && w.sport !== 'rest')
    .map((w) => ({ kind: 'workout' as const, sport: w.sport, title: w.title, start: w.startTime, end: workoutEnd(w) }));
  const fromBusy = busy
    .filter((b) => b.date === date)
    .map((b) => ({ kind: 'busy' as const, sport: null, title: b.title, start: b.start, end: b.end }));
  return [...fromBusy, ...fromWorkouts];
}

export function friendDayEntries(date: ISODate, items: readonly FriendWeekItem[]): DayEntry[] {
  return items
    .filter((i) => i.date === date && i.status !== 'skipped' && i.sport !== 'rest')
    .map((i) => ({
      kind: i.kind,
      sport: i.kind === 'workout' ? i.sport : null,
      title: i.kind === 'busy' ? null : i.title,
      start: i.startTime,
      end: i.endTime ?? (i.startTime && i.durationMin ? addMinutes(i.startTime, i.durationMin) : null),
    }));
}

function overlapsWindow(entry: DayEntry, startMin: number, endMin: number): boolean {
  if (!entry.start || !entry.end) return false;
  return timeToMinutes(entry.start) < endMin && timeToMinutes(entry.end) > startMin;
}

export function findConflicts(entries: readonly DayEntry[], startTime: ISOTime | null, durationMin: number): ConflictReport {
  const sameDay = entries.filter((e) => !e.start && e.kind === 'workout');
  if (!startTime) return { overlaps: [], sameDay };
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(addMinutes(startTime, durationMin));
  const overlaps = entries
    .filter((e) => overlapsWindow(e, startMin, endMin))
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  return { overlaps, sameDay };
}

function span(entry: DayEntry): string {
  return entry.start && entry.end ? ` ${timeRange(entry.start, entry.end)}` : '';
}

/** "Álex está ocupado 18:00–19:00", "Tienes «Clase» 18:00–20:00"… */
export function conflictMessage(entry: DayEntry, who: { isMe: boolean; name: string }): string {
  const when = span(entry);
  if (who.isMe) {
    if (entry.title) return `Tienes «${entry.title}»${when}`;
    return entry.kind === 'busy' ? `Estás ocupado${when}` : `Tienes un entreno${when}`;
  }
  if (entry.kind === 'busy') return `${who.name} está ocupado${when}`;
  if (entry.kind === 'event') return `${who.name} tiene un plan${when}`;
  return entry.title ? `${who.name} tiene «${entry.title}»${when}` : `${who.name} tiene un entreno${when}`;
}

/** A friend's overlapping session of the same sport is a match, not a problem. */
export function isSameSportMatch(entry: DayEntry, sport: Sport): boolean {
  return entry.kind === 'workout' && entry.sport === sport;
}

/** "Álex tiene «Tirada larga» 09:30–10:55: mismo deporte, ¿lo hacéis juntos?" */
export function matchMessage(entry: DayEntry, name: string): string {
  return `${conflictMessage(entry, { isMe: false, name })}: mismo deporte, ¿lo hacéis juntos?`;
}

/** "Álex ya tiene «Natación» ese día (sin hora)". */
export function sameDayMessage(entry: DayEntry, who: { isMe: boolean; name: string }): string {
  const what = entry.title ? `«${entry.title}»` : 'un entreno';
  return who.isMe ? `Ya tienes ${what} ese día (sin hora)` : `${who.name} ya tiene ${what} ese día (sin hora)`;
}
