/**
 * «Tu semana» → «Entrenar con gente» / «Un poco de todo» on «Planificar semana»: the friends'
 * common free slots of the week (Juntos › Huecos) and the planner's proposal fitted to them
 * (`domain/weekSocial.ts`). «Cuando mejor me vaya» or no answer: nothing changes.
 */
import { addDays } from '@/domain/dates';
import { commonSlots, friendBusyIntervals } from '@/domain/together';
import type { DateRange, FriendWeekItem, ISODate, PlanChange, Profile, UUID } from '@/domain/types';
import { answersFor } from '@/domain/weekQuestions';
import { socialLayer, type FriendSlots } from '@/domain/weekSocial';
import { firstName } from '@/features/social/friendModel';
import { busySegments, DEFAULT_FRIEND_WINDOWS, MIN_SLOT_MINUTES, myBusyIntervals, windowsOrDefault } from '@/features/together/intervals';

import type { WeekData } from './useWeekData';

export interface FriendWeek {
  friendId: UUID;
  displayName: string;
  items: FriendWeekItem[];
}

/** Friends asked at most (one request each). */
export const MAX_SOCIAL_FRIENDS = 8;

/** The week's priority when it asks to look at friends ('together' or 'mix'), else null. */
export function socialPriority(profile: Profile | null, weekStart: ISODate) {
  const priority = answersFor(profile, weekStart)?.priority;
  return priority === 'together' || priority === 'mix' ? priority : null;
}

/** Common free slots with each friend for the week (from today on). */
export function friendSlotsFor(data: Pick<WeekData, 'busyBlocks' | 'workouts' | 'profile' | 'today'>, weekStart: ISODate, friends: readonly FriendWeek[]): FriendSlots[] {
  const range: DateRange = { from: weekStart, to: addDays(weekStart, 6) };
  const mine = { busy: myBusyIntervals(busySegments(data.busyBlocks, range), data.workouts), windows: windowsOrDefault(data.profile?.availability.windows) };
  return friends.map((f) => ({
    friendId: f.friendId,
    name: firstName(f.displayName),
    slots: commonSlots({ range, mine, theirs: { busy: friendBusyIntervals(f.items), windows: [...DEFAULT_FRIEND_WINDOWS] }, minMinutes: MIN_SLOT_MINUTES }).filter((s) => s.date >= data.today),
  }));
}

/** The planner's week with the social layer (summary sentence appended), unchanged for 'flexible' or no answer. */
export function withSocial(
  planned: { changes: PlanChange[]; summary: string },
  weekStart: ISODate,
  data: Pick<WeekData, 'busyBlocks' | 'workouts' | 'profile' | 'today'>,
  friends: readonly FriendWeek[],
): { changes: PlanChange[]; summary: string } {
  const priority = socialPriority(data.profile, weekStart);
  if (!priority) return planned;
  const result = socialLayer({ changes: planned.changes, priority, friends: friendSlotsFor(data, weekStart, friends) });
  return { changes: result.changes, summary: result.note ? `${planned.summary} ${result.note}`.trim() : planned.summary };
}
