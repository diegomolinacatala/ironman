/**
 * Demo coach quedadas: imitates the AI coach suggesting ONE joint session with
 * a friend named in the message (`CoachRequest.friendIds`). Deterministic: the
 * first common free slot from tomorrow to the end of the 14-day plan window
 * (same helpers as the Juntos screen). Never creates anything: the app shows a
 * card that opens the prefilled form.
 */
import { addDays, formatDayMedium, maxDate } from '@/domain/dates';
import { commonSlots, friendBusyIntervals, type Interval } from '@/domain/together';
import { localInterval } from '@/domain/timeRanges';
import type {
  BusyBlock,
  CoachRequest,
  DateRange,
  Friend,
  FriendWeekItem,
  ISODate,
  QuedadaSuggestion,
  TrainingWindow,
  Weekday,
  Workout,
} from '@/domain/types';
import { logger } from '@/lib/logger';

import type { Repository } from '../../repository';

export type QuedadaDemoRepo = Pick<Repository, 'getMyProfile' | 'listWorkouts' | 'listBusyBlocks' | 'listFriends' | 'getFriendWeek'>;

const MIN_SLOT_MINUTES = 60;
const SESSION_MINUTES = 60;
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];
/** Friends' windows are unknown: a reasonable training day (same as Juntos). */
const FRIEND_WINDOWS: readonly TrainingWindow[] = WEEKDAYS.map((weekday) => ({ weekday, start: '06:30', end: '22:00' }));

export interface DemoQuedadaInput {
  friend: Friend;
  range: DateRange;
  myWorkouts: readonly Workout[];
  myBusy: readonly BusyBlock[];
  myWindows: readonly TrainingWindow[];
  friendItems: readonly FriendWeekItem[];
}

function myIntervals(workouts: readonly Workout[], busy: readonly BusyBlock[]): Interval[] {
  const timed = workouts.flatMap((w) => {
    if (!w.startTime || w.status === 'skipped' || w.sport === 'rest') return [];
    const interval = localInterval(w.date, w.startTime, w.durationMin);
    return interval ? [interval] : [];
  });
  return [...timed, ...busy.map((b) => ({ start: b.start, end: b.end }))];
}

/** First common free slot of at least an hour → a 1 h easy run together, or null. */
export function suggestDemoQuedada(input: DemoQuedadaInput): QuedadaSuggestion | null {
  const slot = commonSlots({
    range: input.range,
    mine: { busy: myIntervals(input.myWorkouts, input.myBusy), windows: input.myWindows.length > 0 ? [...input.myWindows] : [...FRIEND_WINDOWS] },
    theirs: { busy: friendBusyIntervals([...input.friendItems]), windows: [...FRIEND_WINDOWS] },
    minMinutes: MIN_SLOT_MINUTES,
  })[0];
  if (!slot) return null;
  return {
    friendId: input.friend.profile.id,
    friendName: input.friend.profile.displayName,
    sport: 'run',
    date: slot.date,
    startTime: slot.start,
    durationMin: Math.min(SESSION_MINUTES, slot.minutes),
    intensity: 'endurance',
    title: 'Rodaje juntos',
    location: null,
    reason: `Los dos tenéis libre el ${formatDayMedium(slot.date)} de ${slot.start} a ${slot.end}.`,
  };
}

/** Loads what the suggestion needs for the first accepted friend of the request (chat only). */
export async function demoQuedadaFor(repo: QuedadaDemoRepo, request: CoachRequest, today: ISODate): Promise<QuedadaSuggestion | null> {
  if (request.mode !== 'chat' || !request.friendIds?.length) return null;
  try {
    const friends = await repo.listFriends();
    const friend = request.friendIds
      .map((id) => friends.find((f) => f.status === 'accepted' && f.profile.id === id))
      .find((f): f is Friend => f !== undefined);
    if (!friend) return null;
    const range: DateRange = { from: maxDate(addDays(today, 1), request.weekStart), to: addDays(request.weekStart, 13) };
    if (range.from > range.to) return null;
    const [profile, myWorkouts, myBusy, friendItems] = await Promise.all([
      repo.getMyProfile(),
      repo.listWorkouts(range),
      repo.listBusyBlocks(range),
      repo.getFriendWeek(friend.profile.id, range),
    ]);
    return suggestDemoQuedada({ friend, range, myWorkouts, myBusy, myWindows: profile?.availability.windows ?? [], friendItems });
  } catch (error) {
    // A suggestion is a nice-to-have: the coach answer never fails because of it.
    logger.warn('demo coach quedada unavailable', error);
    return null;
  }
}

/** Reply line for a suggestion ("Te propongo…"), never "ya está enviada". */
export function quedadaReplyLine(quedada: QuedadaSuggestion): string {
  const time = quedada.startTime ? ` a las ${quedada.startTime}` : '';
  return `Te propongo quedar con ${quedada.friendName} el ${formatDayMedium(quedada.date)}${time} para un rodaje suave. Si te encaja, prepara la invitación.`;
}
