/**
 * Pure helpers for quedadas (joint sessions): status copy, my role, ordering.
 */
import type { ISODate, JointParticipant, JointSession, JointStatus, ParticipantStatus, UUID } from '@/domain/types';

import { addMinutes, timeRange } from './intervals';

export type Tone = 'success' | 'danger' | 'info' | 'muted';

export interface StatusCopy {
  label: string;
  tone: Tone;
  icon: 'checkCircle' | 'close' | 'clock';
}

const PARTICIPANT_COPY: Record<ParticipantStatus, StatusCopy> = {
  invited: { label: 'Invitado', tone: 'info', icon: 'clock' },
  accepted: { label: 'Acepta', tone: 'success', icon: 'checkCircle' },
  declined: { label: 'Rechaza', tone: 'danger', icon: 'close' },
};

const SESSION_COPY: Record<JointStatus, StatusCopy> = {
  proposed: { label: 'Pendiente', tone: 'info', icon: 'clock' },
  confirmed: { label: 'Confirmada', tone: 'success', icon: 'checkCircle' },
  cancelled: { label: 'Cancelada', tone: 'danger', icon: 'close' },
};

export function participantStatusCopy(status: ParticipantStatus): StatusCopy {
  return PARTICIPANT_COPY[status];
}

export function sessionStatusCopy(status: JointStatus): StatusCopy {
  return SESSION_COPY[status];
}

/** "18:30–19:40" or "Hora por decidir". */
export function sessionTimeLabel(session: Pick<JointSession, 'startTime' | 'durationMin'>): string {
  if (!session.startTime) return 'Hora por decidir';
  return timeRange(session.startTime, addMinutes(session.startTime, session.durationMin));
}

export function myParticipant(session: JointSession, myId: UUID | null): JointParticipant | null {
  if (!myId) return null;
  return session.participants.find((p) => p.userId === myId) ?? null;
}

export function isOrganizer(session: JointSession, myId: UUID | null): boolean {
  return myId !== null && session.organizerId === myId;
}

/** An invitation waiting for MY answer. */
export function isPendingInviteForMe(session: JointSession, myId: UUID | null): boolean {
  if (session.status === 'cancelled' || isOrganizer(session, myId)) return false;
  return myParticipant(session, myId)?.status === 'invited';
}

/** Other people in the session (for "con Álex"). */
export function otherParticipants(session: JointSession, myId: UUID | null): JointParticipant[] {
  return session.participants.filter((p) => p.userId !== myId);
}

export function withNames(participants: readonly JointParticipant[]): string {
  const names = participants.map((p) => p.displayName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function sortKey(session: JointSession): string {
  return `${session.date}T${session.startTime ?? '99:99'}`;
}

export interface SessionSplit {
  invites: JointSession[];
  upcoming: JointSession[];
}

/** Future, non-cancelled sessions: my pending invites first, then the rest by date. */
export function splitSessions(sessions: readonly JointSession[] | undefined, myId: UUID | null, today: ISODate): SessionSplit {
  const visible = (sessions ?? [])
    .filter((s) => s.status !== 'cancelled' && s.date >= today)
    .filter((s) => myParticipant(s, myId)?.status !== 'declined' || isOrganizer(s, myId))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return {
    invites: visible.filter((s) => isPendingInviteForMe(s, myId)),
    upcoming: visible.filter((s) => !isPendingInviteForMe(s, myId)),
  };
}
