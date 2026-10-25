/**
 * Pure builders: app data → widget props (and WidgetKit timelines).
 * Widgets cannot compute anything themselves, so all text is pre-formatted here.
 */
import { addDays, diffDays, formatDayMedium, formatDayShort, formatDuration, formatTime, startOfWeek } from '@/domain/dates';
import { raceDistanceLabel, sportLabel } from '@/domain/labels';
import { nextRace } from '@/domain/periodization';
import type { ISODate, JointSession, Profile, Race, Workout } from '@/domain/types';

import { atLocal, localDate, parseTimeMinutes, startOfLocalDate } from '../time';
import type { NextWorkoutItem, NextWorkoutWidgetProps } from './NextWorkoutWidget';
import type { RaceWidgetProps } from './RaceWidget';
import type { TodayWidgetProps, WidgetSessionItem, WidgetWeekDay } from './TodayWidget';

export interface WidgetDataInput {
  workouts: readonly Workout[];
  races: readonly Race[];
  jointSessions: readonly JointSession[];
  profile: Profile | null;
  /** "rebufo://" — see `linkBaseFor`. */
  linkBase: string;
}

export interface WidgetPropsBundle {
  today: TodayWidgetProps;
  race: RaceWidgetProps;
  next: NextWorkoutWidgetProps;
}

export interface TimelineEntry<T> {
  date: Date;
  props: T;
}

export interface WidgetTimelines {
  today: TimelineEntry<TodayWidgetProps>[];
  race: TimelineEntry<RaceWidgetProps>[];
  next: TimelineEntry<NextWorkoutWidgetProps>[];
}

const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
const MAX_WEEK_SPORTS = 3;
const NEXT_LOOKAHEAD_DAYS = 7;
const DEFAULT_SCHEME = 'rebufo';

/** Deep-link prefix from the app scheme (`Constants.expoConfig.scheme`), "rebufo://" by default. */
export function linkBaseFor(scheme: unknown): string {
  const first = Array.isArray(scheme) ? scheme[0] : scheme;
  return `${typeof first === 'string' && first ? first : DEFAULT_SCHEME}://`;
}

function isSession(w: Workout): boolean {
  return w.sport !== 'rest' && w.status !== 'skipped';
}

function byStartTime(a: Workout, b: Workout): number {
  const ta = parseTimeMinutes(a.startTime) ?? Number.MAX_SAFE_INTEGER;
  const tb = parseTimeMinutes(b.startTime) ?? Number.MAX_SAFE_INTEGER;
  return ta - tb || a.title.localeCompare(b.title, 'es');
}

function sessionsOn(workouts: readonly Workout[], date: ISODate): Workout[] {
  return workouts.filter((w) => w.date === date && isSession(w)).sort(byStartTime);
}

/** "con Álex" for a quedada (first other participant), else "". */
export function partnerLabel(w: Workout, sessions: readonly JointSession[], meId: string | null): string {
  if (!w.jointSessionId) return '';
  const session = sessions.find((s) => s.id === w.jointSessionId);
  // My participant row is the one linked to this workout (works even without a profile loaded).
  const other = session?.participants.find((p) => p.userId !== meId && p.workoutId !== w.id && p.status !== 'declined');
  return other ? `con ${other.displayName}` : 'Quedada';
}

function toItem(w: Workout, input: WidgetDataInput): WidgetSessionItem {
  return {
    id: w.id,
    title: w.title,
    sport: w.sport,
    sportLabel: sportLabel(w.sport),
    time: formatTime(w.startTime),
    duration: formatDuration(w.durationMin),
    done: w.status === 'completed',
    partner: partnerLabel(w, input.jointSessions, input.profile?.id ?? null),
  };
}

/** Still ahead at `at`: pending and (untimed or not finished yet). */
function isUpcoming(w: Workout, at: Date): boolean {
  if (w.status !== 'planned') return false;
  const start = parseTimeMinutes(w.startTime);
  if (start == null) return true;
  return atLocal(w.date, start + w.durationMin).getTime() > at.getTime();
}

interface WeekStats {
  plannedMin: number;
  completedMin: number;
  sessions: number;
  completedSessions: number;
}

function weekStats(workouts: readonly Workout[], weekStart: ISODate): WeekStats {
  const end = addDays(weekStart, 6);
  const inWeek = workouts.filter((w) => w.date >= weekStart && w.date <= end && w.sport !== 'rest');
  const completed = inWeek.filter((w) => w.status === 'completed');
  return {
    plannedMin: inWeek.reduce((sum, w) => sum + w.durationMin, 0),
    completedMin: completed.reduce((sum, w) => sum + (w.completed?.durationMin ?? w.durationMin), 0),
    sessions: inWeek.length,
    completedSessions: completed.length,
  };
}

function weekPercent(stats: WeekStats): number {
  if (stats.plannedMin <= 0) return 0;
  return Math.min(100, Math.round((stats.completedMin / stats.plannedMin) * 100));
}

/** "45' de 3h 30'" */
function volumeLabel(stats: WeekStats): string {
  return `${formatDuration(stats.completedMin)} de ${formatDuration(stats.plannedMin)}`;
}

function weekDays(workouts: readonly Workout[], weekStart: ISODate, today: ISODate): WidgetWeekDay[] {
  return WEEKDAY_LETTERS.map((letter, i) => {
    const date = addDays(weekStart, i);
    const sessions = sessionsOn(workouts, date);
    return {
      letter,
      day: String(Number(date.slice(8, 10))),
      isToday: date === today,
      sports: [...new Set(sessions.map((w) => w.sport))].slice(0, MAX_WEEK_SPORTS),
      done: sessions.length > 0 && sessions.every((w) => w.status === 'completed'),
    };
  });
}

function buildToday(input: WidgetDataInput, at: Date, today: ISODate): TodayWidgetProps {
  const todays = sessionsOn(input.workouts, today);
  const nextWorkout = todays.find((w) => isUpcoming(w, at)) ?? null;
  const weekStart = startOfWeek(today);
  const stats = weekStats(input.workouts, weekStart);
  return {
    dateLabel: formatDayMedium(today),
    today: todays.map((w) => toItem(w, input)),
    tomorrow: sessionsOn(input.workouts, addDays(today, 1)).map((w) => toItem(w, input)),
    next: nextWorkout ? toItem(nextWorkout, input) : null,
    allDoneToday: todays.length > 0 && todays.every((w) => w.status === 'completed'),
    week: weekDays(input.workouts, weekStart, today),
    weekPercent: weekPercent(stats),
    weekSummary: `${stats.completedSessions}/${stats.sessions} sesiones · ${volumeLabel(stats)}`,
    linkBase: input.linkBase,
  };
}

function buildRace(input: WidgetDataInput, today: ISODate): RaceWidgetProps {
  const race = nextRace([...input.races], today);
  const stats = weekStats(input.workouts, startOfWeek(today));
  const days = race ? diffDays(race.date, today) : null;
  const valid = race !== null && days !== null && days >= 0;
  return {
    raceName: valid ? race.name : null,
    daysToRace: valid ? days : null,
    raceDateLabel: valid ? formatDayMedium(race.date) : '',
    distanceLabel: valid ? raceDistanceLabel(race.distance) : '',
    weekPercent: weekPercent(stats),
    weekLabel: volumeLabel(stats),
    linkBase: input.linkBase,
  };
}

function whenLabel(w: Workout, today: ISODate): string {
  const diff = diffDays(w.date, today);
  const day = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : formatDayShort(w.date);
  const time = formatTime(w.startTime);
  return time ? `${day} ${time}` : day;
}

function buildNext(input: WidgetDataInput, at: Date, today: ISODate): NextWorkoutWidgetProps {
  const candidates = Array.from({ length: NEXT_LOOKAHEAD_DAYS }, (_, i) => addDays(today, i)).flatMap((date) =>
    sessionsOn(input.workouts, date).filter((w) => isUpcoming(w, at)),
  );
  const first = candidates[0];
  const next: NextWorkoutItem | null = first
    ? {
        id: first.id,
        title: first.title,
        sport: first.sport,
        sportLabel: sportLabel(first.sport),
        when: whenLabel(first, today),
        duration: formatDuration(first.durationMin),
        partner: partnerLabel(first, input.jointSessions, input.profile?.id ?? null),
      }
    : null;
  return { next, linkBase: input.linkBase };
}

/** Props of every widget as they should look at `at` (defaults to its local date). */
export function buildWidgetProps(input: WidgetDataInput, at: Date, today: ISODate = localDate(at)): WidgetPropsBundle {
  return {
    today: buildToday(input, at, today),
    race: buildRace(input, today),
    next: buildNext(input, at, today),
  };
}

/** Moments when the next-workout widget must change: each timed session's end. */
function sessionEnds(workouts: readonly Workout[], from: Date, until: Date): Date[] {
  return workouts.flatMap((w) => {
    const start = parseTimeMinutes(w.startTime);
    if (start == null || !isSession(w)) return [];
    const end = atLocal(w.date, start + w.durationMin);
    return end > from && end < until ? [end] : [];
  });
}

/**
 * Timeline entries: now + every following midnight (so "Hoy" rolls over without
 * the app) and, for the lock-screen widget, the end of every timed session.
 */
export function buildWidgetTimelines(
  input: WidgetDataInput,
  now: Date,
  opts?: { today?: ISODate; days?: number },
): WidgetTimelines {
  const today = opts?.today ?? localDate(now);
  const days = opts?.days ?? NEXT_LOOKAHEAD_DAYS;
  const midnights = Array.from({ length: days }, (_, i) => startOfLocalDate(addDays(today, i + 1)));
  const until = midnights[midnights.length - 1] ?? now;
  const dayPoints = [now, ...midnights];
  const nextPoints = [...dayPoints, ...sessionEnds(input.workouts, now, until)].sort((a, b) => a.getTime() - b.getTime());

  const dayOf = (date: Date): ISODate => (date === now ? today : localDate(date));
  return {
    today: dayPoints.map((date) => ({ date, props: buildToday(input, date, dayOf(date)) })),
    race: dayPoints.map((date) => ({ date, props: buildRace(input, dayOf(date)) })),
    next: nextPoints.map((date) => ({ date, props: buildNext(input, date, dayOf(date)) })),
  };
}
