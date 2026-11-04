/**
 * Social side of the local morning briefing ("Juntos"): the athlete's quedadas
 * of the briefing day and the invitations still waiting for their answer, as
 * plain facts (first names, title, sport, time, place). Mirrors
 * `supabase/functions/_shared/briefing/together.ts`; the spoken sentences live
 * in `briefingScript.ts`. Pure.
 */
import { addDays } from './dates';
import type { ISODate, ISOTime, JointSession, Sport, UUID } from './types';

/** Invitations are looked up this many days ahead (briefing day included). */
export const INVITE_HORIZON_DAYS = 14;
const TOGETHER_MAX_ITEMS = 3;
const TEXT_MAX = 80;

export interface TodayJoint {
  title: string;
  sport: Sport;
  startTime: ISOTime | null;
  location: string | null;
  /** First names of the accepted participants other than the athlete. */
  partners: string[];
}

export interface PendingInvite {
  date: ISODate;
  title: string;
  sport: Sport;
  /** First name of the organizer. */
  from: string;
}

export interface BriefingTogether {
  today: TodayJoint[];
  invitations: PendingInvite[];
  /** All the pending invitations (`invitations` keeps only the first few). */
  invitationCount: number;
}

export const NO_TOGETHER: BriefingTogether = { today: [], invitations: [], invitationCount: 0 };

function clean(text: string | null | undefined): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, TEXT_MAX) : null;
}

/** Only the first name of a friend (no surnames). */
function firstOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0]?.slice(0, 40) || 'un amigo';
}

function byWhen(a: JointSession, b: JointSession): number {
  return a.date === b.date ? (a.startTime ?? '99').localeCompare(b.startTime ?? '99') : a.date.localeCompare(b.date);
}

/** Today's quedadas the athlete is in (accepted or organizer) and unanswered invitations dated from `date`. */
export function togetherOf(sessions: readonly JointSession[], me: UUID, date: ISODate): BriefingTogether {
  const last = addDays(date, INVITE_HORIZON_DAYS - 1);
  const live = sessions.filter((s) => s.status !== 'cancelled' && s.date >= date && s.date <= last).sort(byWhen);
  const statusOf = (s: JointSession) => (s.organizerId === me ? 'accepted' : s.participants.find((p) => p.userId === me)?.status);
  const today = live
    .filter((s) => s.date === date && statusOf(s) === 'accepted')
    .slice(0, TOGETHER_MAX_ITEMS)
    .map((s) => ({
      title: clean(s.title) ?? '',
      sport: s.sport,
      startTime: s.startTime,
      location: clean(s.location),
      partners: s.participants.filter((p) => p.userId !== me && p.status === 'accepted').map((p) => firstOf(p.displayName)),
    }));
  const invited = live.filter((s) => statusOf(s) === 'invited');
  const invitations = invited.slice(0, TOGETHER_MAX_ITEMS).map((s) => {
    const organizer = s.participants.find((p) => p.userId === s.organizerId);
    return { date: s.date, title: clean(s.title) ?? '', sport: s.sport, from: organizer ? firstOf(organizer.displayName) : 'un amigo' };
  });
  return { today, invitations, invitationCount: invited.length };
}
