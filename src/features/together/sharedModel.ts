/**
 * "Juntos" extras (pure): weekly volume side by side, races we both run, and
 * what a friend's day looks like for the Hoy card.
 */
import { diffDays } from '@/domain/dates';
import type { CalendarVisibility, FeedItem, FriendRace, FriendWeekItem, ISODate, JointSession, Race, UUID, Workout } from '@/domain/types';

export interface Volume {
  /** Planned + completed minutes this week (rest days excluded). */
  totalMin: number;
  /** Completed minutes so far. */
  doneMin: number;
  sessions: number;
}

export interface WeekVolumes {
  mine: Volume;
  /** Null when the friend only shares busy blocks (no durations). */
  theirs: Volume | null;
}

const EMPTY: Volume = { totalMin: 0, doneMin: 0, sessions: 0 };

function minutesOf(w: Pick<Workout, 'durationMin' | 'completed'>): number {
  return Math.max(0, Math.round(w.completed?.durationMin ?? w.durationMin));
}

export function myVolume(workouts: readonly Workout[]): Volume {
  return workouts
    .filter((w) => w.sport !== 'rest' && (w.status === 'planned' || w.status === 'completed'))
    .reduce<Volume>(
      (acc, w) => ({
        totalMin: acc.totalMin + minutesOf(w),
        doneMin: acc.doneMin + (w.status === 'completed' ? minutesOf(w) : 0),
        sessions: acc.sessions + 1,
      }),
      EMPTY,
    );
}

/** Null when the friend shares only busy blocks ('busy' visibility: no durations). */
export function friendVolume(items: readonly FriendWeekItem[], visibility: CalendarVisibility | null): Volume | null {
  if (visibility === 'busy') return null;
  return items
    .filter((i) => i.kind === 'workout' && i.sport !== 'rest' && i.durationMin !== null && i.status !== 'skipped')
    .reduce<Volume>(
      (acc, i) => ({
        totalMin: acc.totalMin + (i.durationMin ?? 0),
        doneMin: acc.doneMin + (i.status === 'completed' ? i.durationMin ?? 0 : 0),
        sessions: acc.sessions + 1,
      }),
      EMPTY,
    );
}

export function weekVolumes(
  myWorkouts: readonly Workout[],
  friendItems: readonly FriendWeekItem[],
  visibility: CalendarVisibility | null,
): WeekVolumes {
  return { mine: myVolume(myWorkouts), theirs: friendVolume(friendItems, visibility) };
}

// ---------------------------------------------------------------------------
// Shared races
// ---------------------------------------------------------------------------

export interface SharedRace {
  race: Race;
  friends: FriendRace[];
  daysLeft: number;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same day and (same distance or same name): the race we will both run. */
export function isSameRace(mine: Pick<Race, 'date' | 'distance' | 'name'>, theirs: Pick<FriendRace, 'date' | 'distance' | 'name'>): boolean {
  if (mine.date !== theirs.date) return false;
  if (mine.distance === theirs.distance) return true;
  return theirs.name !== null && normalize(theirs.name) === normalize(mine.name);
}

export function sharedRaces(myRaces: readonly Race[], friendRaces: readonly FriendRace[], today: ISODate): SharedRace[] {
  return myRaces
    .filter((r) => r.date >= today)
    .map((race) => ({
      race,
      friends: friendRaces.filter((f) => isSameRace(race, f)),
      daysLeft: diffDays(race.date, today),
    }))
    .filter((s) => s.friends.length > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** "Faltan 120 días", "Es mañana", "Es hoy". */
export function countdownLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Es hoy';
  if (daysLeft === 1) return 'Es mañana';
  return `Faltan ${daysLeft} días`;
}

// ---------------------------------------------------------------------------
// Hoy: social at a glance
// ---------------------------------------------------------------------------

export interface TodaySocial {
  /** Quedadas I'm in today (not cancelled, I accepted or organise). */
  todayJoint: JointSession[];
  /** Friends' activity from the last 24 h (not mine), newest first. */
  recent: FeedItem[];
  /** Friends' open quedadas I could join (next days). */
  open: JointSession[];
}

const RECENT_MS = 24 * 3_600_000;
const MAX_RECENT = 2;

export function todaySocial(input: {
  myId: UUID | null;
  today: ISODate;
  now: Date;
  joint: readonly JointSession[];
  feed: readonly FeedItem[];
  open: readonly JointSession[];
}): TodaySocial {
  const todayJoint = input.joint.filter(
    (s) =>
      s.date === input.today &&
      s.status !== 'cancelled' &&
      s.participants.some((p) => p.userId === input.myId && p.status === 'accepted'),
  );
  const recent = input.feed
    .filter((f) => f.actor.id !== input.myId && input.now.getTime() - Date.parse(f.createdAt) <= RECENT_MS)
    .slice(0, MAX_RECENT);
  return { todayJoint, recent, open: input.open.slice(0, 2) };
}

export function hasTodaySocial(s: TodaySocial): boolean {
  return s.todayJoint.length > 0 || s.recent.length > 0 || s.open.length > 0;
}
