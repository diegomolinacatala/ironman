/**
 * Day-by-day model of a week used by the planner and the re-planner:
 * free time (windows − busy − timed sessions), fixed items (existing
 * workouts, quedadas, other sports) with their hard points, restrictions.
 */
import { NOW_BUFFER_MIN, SLOT_MARGIN_MIN } from './constants';
import { timeToMinutes, weekdayOf } from './dates';
import { lifeEventHardPoints, workoutHardPoints } from './hardness';
import type { DayRestriction } from './restrictions';
import { NO_RESTRICTION } from './restrictions';
import { busyRangesOn, mergeRanges, subtractRanges, windowRangesOn, type MinuteRange } from './timeRanges';
import type { BusyBlock, Intensity, ISODate, ISOTime, LifeEvent, Sport, TrainingWindow, Weekday } from './types';

/** A session already fixed on the calendar (existing workout, quedada, other sport). */
export interface FixedItem {
  id: string | null;
  sport: Sport;
  intensity: Intensity;
  durationMin: number;
  startTime: ISOTime | null;
  hardPoints: number;
  /** Run QUALITY or LONG (48 h rule). */
  runKey: boolean;
  /** Leg-heavy key session (no heavy strength the day before). */
  legKey: boolean;
  strengthHeavy: boolean;
  isOtherSport: boolean;
}

export interface DayState {
  date: ISODate;
  weekday: Weekday;
  plannable: boolean;
  isRestDay: boolean;
  isLongDay: boolean;
  isPoolDay: boolean;
  hasUserWindows: boolean;
  free: MinuteRange[];
  /** Minutes of untimed fixed sessions (consume capacity without a slot). */
  untimedMin: number;
  fixed: FixedItem[];
  restriction: DayRestriction;
  /** Max total minutes on the day (fixed + new), e.g. the L05 easy day; null/undefined = no cap. */
  dayCapMin?: number | null;
}

export interface FixedInput {
  id: string | null;
  date: ISODate;
  sport: Sport;
  intensity: Intensity;
  durationMin: number;
  startTime: ISOTime | null;
}

export interface WeekModelInput {
  dates: readonly ISODate[];
  firstPlannable: ISODate;
  restDay: Weekday | null;
  longSessionDays: readonly Weekday[];
  poolDays: readonly Weekday[];
  windows: readonly TrainingWindow[];
  busyBlocks: readonly BusyBlock[];
  fixed: readonly FixedInput[];
  lifeEvents: readonly LifeEvent[];
  restrictions: Readonly<Record<ISODate, DayRestriction>>;
  /** Today's date and local clock (minutes since midnight): time already gone is not free. */
  today?: ISODate;
  nowMinutes?: number;
}

/** Time already gone on today's date (plus a buffer to get ready), as a range to subtract. */
function pastRange(date: ISODate, input: WeekModelInput): MinuteRange[] {
  const now = input.nowMinutes;
  if (input.today !== date || now === undefined || !Number.isFinite(now)) return [];
  return [{ start: 0, end: Math.max(0, now) + NOW_BUFFER_MIN }];
}

export function fixedFromWorkout(w: FixedInput): FixedItem {
  const hp = workoutHardPoints(w);
  const isQualityOrLong = hp >= 0.5 && w.intensity !== 'recovery';
  return {
    id: w.id,
    sport: w.sport,
    intensity: w.intensity,
    durationMin: w.durationMin,
    startTime: w.startTime,
    hardPoints: hp,
    runKey: w.sport === 'run' && isQualityOrLong,
    legKey: (w.sport === 'run' || w.sport === 'brick' || w.sport === 'bike') && hp >= 1,
    strengthHeavy: w.sport === 'strength' && hp >= 0.5,
    isOtherSport: false,
  };
}

function fixedFromEvent(e: LifeEvent): FixedItem {
  return {
    id: e.id,
    sport: 'other',
    intensity: e.severity >= 2 ? 'threshold' : 'tempo',
    durationMin: e.durationMin ?? 90,
    startTime: e.startTime,
    hardPoints: lifeEventHardPoints(e),
    runKey: false,
    legKey: true,
    strengthHeavy: false,
    isOtherSport: true,
  };
}

function isSportEvent(e: LifeEvent): boolean {
  return e.kind === 'padel' || e.kind === 'football' || e.kind === 'other_sport';
}

function timedRange(item: FixedItem): MinuteRange | null {
  if (!item.startTime) return null;
  const start = timeToMinutes(item.startTime);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + Math.max(0, item.durationMin) + (SLOT_MARGIN_MIN[item.sport] ?? 0) };
}

/** Event time blocks (work meeting, exam…) are busy too, whatever their kind. */
function eventBusyRange(e: LifeEvent, date: ISODate): MinuteRange | null {
  if (!e.startTime || !e.durationMin || e.startDate !== date) return null;
  const start = timeToMinutes(e.startTime);
  return Number.isFinite(start) ? { start, end: start + e.durationMin } : null;
}

export function buildWeekModel(input: WeekModelInput): DayState[] {
  return input.dates.map((date) => {
    const weekday = weekdayOf(date);
    const fixed = [
      ...input.fixed.filter((f) => f.date === date).map(fixedFromWorkout),
      ...input.lifeEvents.filter((e) => isSportEvent(e) && e.startDate <= date && e.endDate >= date).map(fixedFromEvent),
    ];
    const { ranges, isDefault } = windowRangesOn(date, input.windows);
    const timed = fixed.map(timedRange).filter((r): r is MinuteRange => r !== null);
    const eventBlocks = input.lifeEvents.map((e) => eventBusyRange(e, date)).filter((r): r is MinuteRange => r !== null);
    const busy = busyRangesOn(date, input.busyBlocks);
    const free = subtractRanges(ranges, mergeRanges([...busy, ...timed, ...eventBlocks, ...pastRange(date, input)]));
    const restriction = input.restrictions[date] ?? NO_RESTRICTION;
    const isRestDay = input.restDay !== null && weekday === input.restDay;
    return {
      date,
      weekday,
      plannable: date >= input.firstPlannable && !isRestDay && !restriction.noTraining,
      isRestDay,
      isLongDay: input.longSessionDays.includes(weekday),
      isPoolDay: input.poolDays.length === 0 || input.poolDays.includes(weekday),
      hasUserWindows: !isDefault,
      free,
      untimedMin: fixed.filter((f) => !f.startTime).reduce((s, f) => s + f.durationMin, 0),
      fixed,
      restriction,
    };
  });
}
