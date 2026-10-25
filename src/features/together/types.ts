/**
 * Types derived from the domain `together` module (so this feature keeps
 * compiling whether or not the domain exports them by name).
 */
import type { findOpportunities, freeSlots, friendBusyIntervals } from '@/domain/together';
import type { ISODate, ISOTime, Sport, UUID, Workout, WorkoutStatus } from '@/domain/types';

export type Slot = ReturnType<typeof freeSlots>[number];
export type Opportunity = ReturnType<typeof findOpportunities>[number];
export type Interval = ReturnType<typeof friendBusyIntervals>[number];

/** A busy block cut to one local day. */
export interface BusySegment {
  key: string;
  date: ISODate;
  start: ISOTime;
  end: ISOTime;
  title: string | null;
}

export type LaneKind = 'workout' | 'busy' | 'event';

/** One entry in a person's lane for a day (mine or a friend's, already masked). */
export interface LaneEntry {
  key: string;
  kind: LaneKind;
  sport: Sport | null;
  /** null when masked by the friend's visibility. */
  title: string | null;
  startTime: ISOTime | null;
  endTime: ISOTime | null;
  durationMin: number | null;
  status: WorkoutStatus | null;
  isJoint: boolean;
  /** Only for my own workouts (navigation, compliance). */
  workout: Workout | null;
}

export interface CompareDay {
  date: ISODate;
  isToday: boolean;
  isPast: boolean;
  mine: LaneEntry[];
  theirs: LaneEntry[];
  slots: Slot[];
}

export interface JointPrefill {
  friendId?: UUID;
  date?: ISODate;
  sport?: Sport;
  startTime?: ISOTime;
  durationMin?: number;
  fromWorkoutId?: UUID;
  title?: string;
}
