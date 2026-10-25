/**
 * Loads and computes everything the compare views need for one friend and one
 * week: both lanes, common free slots ("Huecos") and opportunities.
 */
import { useMemo } from 'react';

import { addDays } from '@/domain/dates';
import { commonSlots, findOpportunities, friendBusyIntervals } from '@/domain/together';
import type { CalendarVisibility, DateRange, FriendWeekItem, ISODate, Profile, UUID, Workout, BusyBlock } from '@/domain/types';
import { useBusyBlocks, useFriends, useFriendWeek, useProfile, useWorkouts } from '@/data/queries';
import { logger } from '@/lib/logger';

import { buildCompareDays, futureSlots, inferVisibility } from './compareModel';
import { busySegments, DEFAULT_FRIEND_WINDOWS, MIN_SLOT_MINUTES, myBusyIntervals, windowsOrDefault } from './intervals';
import type { CompareDay, Opportunity, Slot } from './types';

export interface TogetherWeek {
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  isRefetching: boolean;
  days: CompareDay[];
  /** Upcoming common slots (past ones dropped, today's trimmed to now). */
  slots: Slot[];
  opportunities: Opportunity[];
  visibility: CalendarVisibility | null;
  friendItems: FriendWeekItem[];
  myWorkouts: Workout[];
}

interface ComputeInput {
  range: DateRange;
  today: ISODate;
  now: Date;
  profile: Profile | null;
  workouts: readonly Workout[];
  blocks: readonly BusyBlock[];
  friendItems: readonly FriendWeekItem[];
}

type Computed = Pick<TogetherWeek, 'days' | 'slots' | 'opportunities' | 'visibility'>;

const EMPTY: Computed = { days: [], slots: [], opportunities: [], visibility: null };

function computeSlots(input: ComputeInput, segments: ReturnType<typeof busySegments>): Slot[] {
  const all = commonSlots({
    range: input.range,
    mine: { busy: myBusyIntervals(segments, input.workouts), windows: windowsOrDefault(input.profile?.availability.windows) },
    theirs: { busy: friendBusyIntervals([...input.friendItems]), windows: [...DEFAULT_FRIEND_WINDOWS] },
    minMinutes: MIN_SLOT_MINUTES,
  });
  return futureSlots(all, input.now);
}

export function computeTogether(input: ComputeInput): Computed {
  try {
    const segments = busySegments(input.blocks, input.range);
    const slots = computeSlots(input, segments);
    const opportunities = findOpportunities({
      range: input.range,
      myWorkouts: [...input.workouts],
      friendItems: [...input.friendItems],
      slots,
    })
      .filter((o) => o.date >= input.today)
      .sort((a, b) => b.score - a.score);
    const days = buildCompareDays({
      range: input.range,
      today: input.today,
      myWorkouts: input.workouts,
      myBusy: segments,
      friendItems: input.friendItems,
      slots,
    });
    return { days, slots, opportunities, visibility: inferVisibility(input.friendItems) };
  } catch (error) {
    logger.error('together: compute failed', error);
    return EMPTY;
  }
}

export function useTogetherWeek(friendId: UUID | undefined, weekStart: ISODate, today: ISODate): TogetherWeek {
  const range: DateRange = useMemo(() => ({ from: weekStart, to: addDays(weekStart, 6) }), [weekStart]);
  const profile = useProfile();
  const workouts = useWorkouts(range);
  const blocks = useBusyBlocks(range);
  const friendWeek = useFriendWeek(friendId, range);
  const friends = useFriends();
  /** What the friend actually shares (server truth); inference from items is only a fallback. */
  const sharedVisibility = friends.data?.find((f) => f.profile.id === friendId)?.visibility ?? null;

  const computed = useMemo(
    () =>
      computeTogether({
        range,
        today,
        now: new Date(),
        profile: profile.data ?? null,
        workouts: workouts.data ?? [],
        blocks: blocks.data ?? [],
        friendItems: friendWeek.data ?? [],
      }),
    [range, today, profile.data, workouts.data, blocks.data, friendWeek.data],
  );

  const queries = [profile, workouts, blocks, friendWeek];
  return {
    ...computed,
    visibility: sharedVisibility ?? computed.visibility,
    isLoading: queries.some((q) => q.isLoading),
    error: queries.find((q) => q.error)?.error ?? null,
    isRefetching: queries.some((q) => q.isRefetching),
    refetch: () => queries.forEach((q) => void q.refetch()),
    friendItems: friendWeek.data ?? [],
    myWorkouts: workouts.data ?? [],
  };
}
