/**
 * Social side of the morning briefing ("Juntos"): the athlete's quedadas of the
 * briefing day (with whom, time, title, place) and the invitations still waiting
 * for their answer. Only what the joint session already shows a participant goes
 * to the model: first names of the participants, title, sport, time and place.
 * Friends' open quedadas are not included: `list_open_joint_sessions` needs the
 * user's JWT (auth.uid()) and there is no service-role variant.
 */
import { addDays, diffDays, weekdayOf, WEEKDAYS_ES } from '../dates.ts';
import { sportLabel } from '../planning/labels.ts';
import type { ISODate, ISOTime, JointSession, UUID } from '../types.ts';

/** Invitations are looked up this many days ahead (briefing day included). */
export const INVITE_HORIZON_DAYS = 14;
/** At most this many quedadas / invitations reach the model. */
export const TOGETHER_MAX_ITEMS = 3;
const TEXT_MAX = 80;

export interface TodayJoint {
  title: string;
  sport: string;
  startTime: ISOTime | null;
  location: string | null;
  /** First names of the accepted participants other than the athlete. */
  partners: string[];
  /** False while nobody else has accepted yet. */
  confirmed: boolean;
}

export interface PendingInvite {
  date: ISODate;
  weekday: string;
  /** Days from the briefing date (0 = that same day). */
  inDays: number;
  title: string;
  sport: string;
  startTime: ISOTime | null;
  location: string | null;
  /** First name of the organizer. */
  from: string;
}

export interface BriefingTogether {
  today: TodayJoint[];
  invitations: PendingInvite[];
}

export const NO_TOGETHER: BriefingTogether = { today: [], invitations: [] };

const clean = (text: string | null | undefined): string | null => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, TEXT_MAX) : null;
};

/** Only the first name of a friend (no surnames). */
const firstOf = (displayName: string): string => displayName.trim().split(/\s+/)[0]?.slice(0, 40) || 'un amigo';

const byWhen = (a: JointSession, b: JointSession): number =>
  a.date === b.date ? (a.startTime ?? '99').localeCompare(b.startTime ?? '99') : a.date.localeCompare(b.date);

function todayJoint(s: JointSession, userId: UUID): TodayJoint {
  const partners = s.participants.filter((p) => p.userId !== userId && p.status === 'accepted').map((p) => firstOf(p.displayName));
  return {
    title: clean(s.title) ?? sportLabel(s.sport),
    sport: sportLabel(s.sport),
    startTime: s.startTime,
    location: clean(s.location),
    partners,
    confirmed: partners.length > 0,
  };
}

function pendingInvite(s: JointSession, date: ISODate): PendingInvite {
  const organizer = s.participants.find((p) => p.userId === s.organizerId);
  return {
    date: s.date,
    weekday: WEEKDAYS_ES[weekdayOf(s.date)],
    inDays: diffDays(s.date, date),
    title: clean(s.title) ?? sportLabel(s.sport),
    sport: sportLabel(s.sport),
    startTime: s.startTime,
    location: clean(s.location),
    from: organizer ? firstOf(organizer.displayName) : 'un amigo',
  };
}

/** Today's quedadas the athlete is in, and invitations (dated from `date`) still unanswered. */
export function togetherOf(sessions: readonly JointSession[], userId: UUID, date: ISODate): BriefingTogether {
  const live = sessions.filter((s) => s.status !== 'cancelled' && s.date >= date && s.date <= addDays(date, INVITE_HORIZON_DAYS - 1)).sort(byWhen);
  const statusOf = (s: JointSession) => (s.organizerId === userId ? 'accepted' : s.participants.find((p) => p.userId === userId)?.status);
  return {
    today: live
      .filter((s) => s.date === date && statusOf(s) === 'accepted')
      .slice(0, TOGETHER_MAX_ITEMS)
      .map((s) => todayJoint(s, userId)),
    invitations: live
      .filter((s) => statusOf(s) === 'invited')
      .slice(0, TOGETHER_MAX_ITEMS)
      .map((s) => pendingInvite(s, date)),
  };
}

/** Prompt view: absent when there is nothing social (so the model does not talk about friends). */
export function togetherForPrompt(t: BriefingTogether): Record<string, unknown> | null {
  if (t.today.length === 0 && t.invitations.length === 0) return null;
  return {
    ...(t.today.length ? { todayJointSessions: t.today } : {}),
    ...(t.invitations.length ? { pendingInvitations: t.invitations } : {}),
  };
}
