/**
 * "Juntos": free slots (Huecos), common slots between two athletes and
 * training opportunities (Oportunidades). Research 01 §4.5.
 */
import { daysInRange, formatDayMedium, minutesToTime, timeToMinutes } from './dates';
import { sportLabel } from './labels';
import {
  busyRangesOn,
  intersectRanges,
  localInterval,
  subtractRanges,
  windowRangesOn,
  type DateTimeInterval,
  type MinuteRange,
} from './timeRanges';
import {
  INTENSITIES,
  type DateRange,
  type FriendWeekItem,
  type Intensity,
  type ISODate,
  type ISOTime,
  type Sport,
  type TrainingWindow,
  type UUID,
  type Workout,
} from './types';

export type Interval = DateTimeInterval;

export interface Slot {
  date: ISODate;
  start: ISOTime;
  end: ISOTime;
  minutes: number;
}

export type OpportunityKind = 'same_session' | 'same_sport' | 'free_slot';

export interface Opportunity {
  id: string;
  date: ISODate;
  sport: Sport;
  kind: OpportunityKind;
  myWorkoutId: UUID | null;
  friendItemId: UUID | null;
  start: ISOTime | null;
  durationMin: number;
  /** 0..1 */
  score: number;
  title: string;
  /** Spanish one-liner. */
  reason: string;
}

export interface FreeSlotsInput {
  date: ISODate;
  busy: Interval[];
  windows: TrainingWindow[];
  minMinutes: number;
  dayStart?: ISOTime;
  dayEnd?: ISOTime;
}

const DEFAULT_TRAVEL_BUFFER_MIN = 15;

function toSlots(date: ISODate, ranges: readonly MinuteRange[], minMinutes: number): Slot[] {
  return ranges
    .filter((r) => r.end - r.start >= Math.max(1, minMinutes))
    .map((r) => ({ date, start: minutesToTime(r.start), end: minutesToTime(r.end), minutes: r.end - r.start }));
}

function freeRanges(date: ISODate, busy: readonly Interval[], windows: readonly TrainingWindow[], bufferMin: number, dayStart?: ISOTime, dayEnd?: ISOTime): MinuteRange[] {
  const { ranges } = windowRangesOn(date, windows, dayStart, dayEnd);
  return subtractRanges(ranges, busyRangesOn(date, busy, bufferMin));
}

/** Free time inside the training windows of `date` (whole default day when it has no windows). */
export function freeSlots(input: FreeSlotsInput): Slot[] {
  return toSlots(input.date, freeRanges(input.date, input.busy, input.windows, 0, input.dayStart, input.dayEnd), input.minMinutes);
}

export interface CommonSlotsInput {
  range: DateRange;
  mine: { busy: Interval[]; windows: TrainingWindow[] };
  theirs: { busy: Interval[]; windows: TrainingWindow[] };
  minMinutes: number;
  /** Margin around busy blocks for getting there (default 15'). */
  travelBufferMin?: number;
}

/** Slots where both athletes are free (busy blocks padded by the travel buffer). */
export function commonSlots(input: CommonSlotsInput): Slot[] {
  const buffer = input.travelBufferMin ?? DEFAULT_TRAVEL_BUFFER_MIN;
  return daysInRange(input.range).flatMap((date) => {
    const mine = freeRanges(date, input.mine.busy, input.mine.windows, buffer);
    const theirs = freeRanges(date, input.theirs.busy, input.theirs.windows, buffer);
    return toSlots(date, intersectRanges(mine, theirs), input.minMinutes);
  });
}

/** Busy blocks plus timed workouts/events of the friend as intervals. */
export function friendBusyIntervals(items: FriendWeekItem[]): Interval[] {
  return items.flatMap((item): Interval[] => {
    if (!item.startTime || item.status === 'skipped') return [];
    if (item.kind === 'busy' || (item.endTime && item.durationMin === null)) {
      if (!item.endTime) return [];
      const start = timeToMinutes(item.startTime);
      const end = timeToMinutes(item.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const interval = localInterval(item.date, item.startTime, end - start);
      return interval ? [interval] : [];
    }
    if (item.durationMin === null) return [];
    const interval = localInterval(item.date, item.startTime, item.durationMin);
    return interval ? [interval] : [];
  });
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export interface FindOpportunitiesInput {
  range: DateRange;
  myWorkouts: Workout[];
  friendItems: FriendWeekItem[];
  /** Common slots (from commonSlots). */
  slots: Slot[];
}

const JOINT_TITLES: Record<Sport, string> = {
  swim: 'Piscina juntos',
  bike: 'Salida en bici juntos',
  run: 'Rodaje juntos',
  brick: 'Brick juntos',
  strength: 'Gimnasio juntos',
  mobility: 'Movilidad juntos',
  other: 'Entreno juntos',
  rest: 'Entreno juntos',
};

function rank(i: Intensity | null): number {
  return i === null ? 1 : INTENSITIES.indexOf(i);
}

const EASY_MAX_RANK = INTENSITIES.indexOf('endurance');

function compatibility(a: Intensity, b: Intensity | null): { kind: OpportunityKind; score: number } {
  const ra = rank(a);
  const rb = rank(b);
  if (ra <= EASY_MAX_RANK && rb <= EASY_MAX_RANK) return { kind: 'same_session', score: 0.9 };
  if (Math.abs(ra - rb) <= 1) return { kind: 'same_session', score: 0.75 };
  if (ra > EASY_MAX_RANK && rb > EASY_MAX_RANK) return { kind: 'same_session', score: 0.6 };
  return { kind: 'same_sport', score: 0.5 };
}

/** Max distance (min) between my timed workout and the common slots around it to read the gap as mine. */
const OWN_GAP_TOLERANCE_MIN = 2 * DEFAULT_TRAVEL_BUFFER_MIN;

/** Common time window around my own timed workout (my workout blocks it in `slots`). */
interface OwnGap {
  start: ISOTime;
  end: ISOTime;
}

/**
 * `slots` usually come from commonSlots with my timed planned workouts counted
 * as busy, so a workout never fits a slot by itself. The hole is "mine" when
 * common slots end right before and start right after it and the friend has
 * no busy time inside: then that time is free for both of us.
 */
function ownGap(date: ISODate, start: ISOTime, durationMin: number, slots: readonly Slot[], friendBusy: readonly Interval[]): OwnGap | null {
  const s = timeToMinutes(start);
  const e = s + durationMin;
  if (!Number.isFinite(s)) return null;
  const day = slots.filter((x) => x.date === date);
  const before = day.find((x) => timeToMinutes(x.end) <= s && s - timeToMinutes(x.end) <= OWN_GAP_TOLERANCE_MIN);
  const after = day.find((x) => timeToMinutes(x.start) >= e && timeToMinutes(x.start) - e <= OWN_GAP_TOLERANCE_MIN);
  if (!before || !after) return null;
  const friendClash = busyRangesOn(date, [...friendBusy]).some((r) => r.start < e && r.end > s);
  return friendClash ? null : { start: before.start, end: after.end };
}

function fitsSlot(date: ISODate, start: ISOTime, durationMin: number, slots: readonly Slot[]): Slot | undefined {
  const s = timeToMinutes(start);
  return slots.find((x) => x.date === date && s >= timeToMinutes(x.start) && s + durationMin <= timeToMinutes(x.end));
}

function slotStartFor(date: ISODate, durationMin: number, slots: readonly Slot[], preferred: ISOTime | null, friendBusy: readonly Interval[]): ISOTime | null {
  const fitting = slots.filter((s) => s.date === date && s.minutes >= durationMin);
  if (preferred) {
    if (fitsSlot(date, preferred, durationMin, fitting) || ownGap(date, preferred, durationMin, slots, friendBusy)) return preferred;
  }
  return fitting[0]?.start ?? null;
}

function pickStart(mine: Workout, friend: FriendWeekItem, durationMin: number, slots: readonly Slot[], friendBusy: readonly Interval[]): { start: ISOTime | null; bonus: number } {
  if (mine.startTime && friend.startTime) {
    const gap = Math.abs(timeToMinutes(mine.startTime) - timeToMinutes(friend.startTime));
    if (gap <= 60) return { start: mine.startTime, bonus: 0.05 };
  }
  const start = slotStartFor(mine.date, durationMin, slots, mine.startTime ?? friend.startTime, friendBusy);
  return start ? { start, bonus: 0 } : { start: null, bonus: -0.15 };
}

function round2(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

function pairOpportunity(mine: Workout, friend: FriendWeekItem, slots: readonly Slot[], friendBusy: readonly Interval[]): Opportunity | null {
  if (friend.kind !== 'workout' || friend.sport !== mine.sport || friend.jointSessionId || friend.status === 'completed' || friend.status === 'skipped') return null;
  const compat = compatibility(mine.intensity, friend.intensity);
  const durationMin = Math.min(mine.durationMin, friend.durationMin ?? mine.durationMin);
  const { start, bonus } = pickStart(mine, friend, durationMin, slots, friendBusy);
  const day = formatDayMedium(mine.date);
  const sport = sportLabel(mine.sport).toLowerCase();
  const reason =
    compat.kind === 'same_session'
      ? `Los dos tenéis ${sport} el ${day}: ¿lo hacéis juntos?`
      : `Los dos tenéis ${sport} el ${day} con intensidades distintas: id juntos y cada uno hace su serie.`;
  return {
    id: `${compat.kind}:${mine.date}:${mine.id}:${friend.id ?? '-'}`,
    date: mine.date,
    sport: mine.sport,
    kind: compat.kind,
    myWorkoutId: mine.id,
    friendItemId: friend.id,
    start,
    durationMin,
    score: round2(compat.score + bonus),
    title: JOINT_TITLES[mine.sport],
    reason,
  };
}

/** Common window for `mine`: any fitting slot (untimed), the slot holding it, or the gap it leaves itself. */
function freeWindowFor(mine: Workout, slots: readonly Slot[], friendBusy: readonly Interval[]): OwnGap | null {
  if (!mine.startTime) return slots.find((s) => s.date === mine.date && s.minutes >= mine.durationMin) ?? null;
  return fitsSlot(mine.date, mine.startTime, mine.durationMin, slots) ?? ownGap(mine.date, mine.startTime, mine.durationMin, slots, friendBusy);
}

function freeSlotOpportunity(mine: Workout, slots: readonly Slot[], friendBusy: readonly Interval[]): Opportunity | null {
  const slot = freeWindowFor(mine, slots, friendBusy);
  if (!slot) return null;
  return {
    id: `free_slot:${mine.date}:${mine.id}:${slot.start}`,
    date: mine.date,
    sport: mine.sport,
    kind: 'free_slot',
    myWorkoutId: mine.id,
    friendItemId: null,
    start: mine.startTime ?? slot.start,
    durationMin: mine.durationMin,
    score: 0.4,
    title: JOINT_TITLES[mine.sport],
    reason: `Los dos estáis libres el ${formatDayMedium(mine.date)} de ${slot.start} a ${slot.end}: buen hueco para ${sportLabel(mine.sport).toLowerCase()}.`,
  };
}

function isCandidate(w: Workout, range: DateRange): boolean {
  return w.status === 'planned' && w.sport !== 'rest' && w.jointSessionId === null && w.date >= range.from && w.date <= range.to;
}

/**
 * Best opportunity per planned workout of mine, sorted by score (then date, start).
 * `slots` may or may not count my own timed workouts as busy: the gap a timed
 * workout leaves in them is treated as free when the friend has nothing then.
 */
export function findOpportunities(input: FindOpportunitiesInput): Opportunity[] {
  const friendBusy = friendBusyIntervals(input.friendItems);
  const mine = input.myWorkouts.filter((w) => isCandidate(w, input.range)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const best = mine.flatMap((w) => {
    const pairs = input.friendItems
      .filter((f) => f.date === w.date)
      .map((f) => pairOpportunity(w, f, input.slots, friendBusy))
      .filter((o): o is Opportunity => o !== null);
    const candidates = pairs.length > 0 ? pairs : [freeSlotOpportunity(w, input.slots, friendBusy)].filter((o): o is Opportunity => o !== null);
    const top = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
    return top ? [top] : [];
  });
  return best.sort(
    (a, b) => b.score - a.score || a.date.localeCompare(b.date) || (a.start ?? '99:99').localeCompare(b.start ?? '99:99') || a.id.localeCompare(b.id),
  );
}
