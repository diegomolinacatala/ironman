/** Pure selectors for the Hoy screen (unit-tested). */
import type {
  AppNotification,
  DailyCheckin,
  ISODate,
  JointSession,
  UUID,
  Workout,
} from '@/domain/types';

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;
const WEEKDAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

/** "sábado 25 oct" (rendered uppercase by the overline style). */
export function todayHeadline(date: ISODate): string {
  const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
  const js = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
  return `${WEEKDAYS_LONG[js.getDay()]} ${js.getDate()} ${MONTHS_SHORT[js.getMonth()]}`;
}

function byStartTime(a: Workout, b: Workout): number {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

/** Workouts of a date, timed first in chronological order. */
export function workoutsOn(workouts: readonly Workout[], date: ISODate): Workout[] {
  return workouts.filter((w) => w.date === date).sort(byStartTime);
}

export interface TodayPlan {
  /** Next session still to do today (null when none). */
  hero: Workout | null;
  /** The rest of today's sessions (done, skipped or later). */
  others: Workout[];
  /** True when today only has rest (or nothing). */
  isRestDay: boolean;
  /** True when every non-rest session of today is completed or skipped. */
  allDone: boolean;
}

export function planForToday(workouts: readonly Workout[], today: ISODate): TodayPlan {
  const todays = workoutsOn(workouts, today);
  const training = todays.filter((w) => w.sport !== 'rest');
  const hero = training.find((w) => w.status === 'planned') ?? null;
  return {
    hero,
    others: todays.filter((w) => w.id !== hero?.id),
    isRestDay: training.length === 0,
    allDone: training.length > 0 && hero == null,
  };
}

/** Quedadas where I am invited and have not answered yet (not cancelled, not past). */
export function pendingInvites(sessions: readonly JointSession[], myId: UUID | undefined, today: ISODate): JointSession[] {
  if (!myId) return [];
  return sessions.filter(
    (s) =>
      s.status !== 'cancelled' &&
      s.date >= today &&
      s.organizerId !== myId &&
      s.participants.some((p) => p.userId === myId && p.status === 'invited'),
  );
}

export function unreadCount(notifications: readonly AppNotification[] | undefined): number {
  return (notifications ?? []).filter((n) => n.readAt == null).length;
}

export function checkinFor(checkins: readonly DailyCheckin[] | undefined, date: ISODate): DailyCheckin | null {
  return (checkins ?? []).find((c) => c.date === date) ?? null;
}

/** Organizer's display name for an invite banner. */
export function organizerName(session: JointSession): string {
  const organizer = session.participants.find((p) => p.userId === session.organizerId);
  return organizer?.displayName.split(/\s+/)[0] ?? 'Un amigo';
}
