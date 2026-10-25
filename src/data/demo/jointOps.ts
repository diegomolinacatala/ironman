/**
 * Quedadas (joint sessions) in the demo DB — pure transitions mirroring the
 * `propose_joint_session` / `respond_joint_session` / `cancel_joint_session` RPCs.
 */
import { formatDayLabel } from '@/domain/dates';
import type { DateRange, JointSession, JointSessionDraft, UUID, Workout } from '@/domain/types';

import { RepositoryError } from '../repository';
import { profileOf, type DemoClock, type DemoDb, type DemoJointSession, type DemoParticipant } from './db';
import { addFeedEvent, displayName, notify } from './events';
import { assertJointDraft } from './validation';

export function areFriends(db: DemoDb, a: UUID, b: UUID): boolean {
  return db.friendships.some(
    (f) =>
      f.status === 'accepted' &&
      ((f.requesterId === a && f.addresseeId === b) || (f.requesterId === b && f.addresseeId === a)),
  );
}

export function toJointSession(db: DemoDb, s: DemoJointSession): JointSession {
  return {
    ...s,
    participants: s.participants.map((p) => ({
      userId: p.userId,
      displayName: displayName(db, p.userId),
      avatarUrl: profileOf(db, p.userId)?.avatarUrl ?? null,
      status: p.status,
      workoutId: p.workoutId,
    })),
  };
}

function involves(s: DemoJointSession, userId: UUID): boolean {
  return s.organizerId === userId || s.participants.some((p) => p.userId === userId);
}

export function listJointFor(db: DemoDb, userId: UUID, range: DateRange): JointSession[] {
  return db.jointSessions
    .filter((s) => involves(s, userId) && s.date >= range.from && s.date <= range.to)
    .sort((a, b) => (a.date === b.date ? (a.startTime ?? '').localeCompare(b.startTime ?? '') : a.date < b.date ? -1 : 1))
    .map((s) => toJointSession(db, s));
}

export function getJointFor(db: DemoDb, userId: UUID, id: UUID): JointSession | null {
  const s = db.jointSessions.find((x) => x.id === id);
  return s && involves(s, userId) ? toJointSession(db, s) : null;
}

function jointWorkout(s: DemoJointSession, userId: UUID, clock: DemoClock): Workout {
  return {
    id: clock.newId(),
    userId,
    date: s.date,
    startTime: s.startTime,
    sport: s.sport,
    title: s.title,
    description: [s.location, s.notes].filter(Boolean).join(' · ') || null,
    durationMin: s.durationMin,
    distanceM: null,
    intensity: s.intensity,
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'joint',
    isKey: false,
    jointSessionId: s.id,
    externalId: null,
    createdAt: clock.now,
    updatedAt: clock.now,
  };
}

function when(s: Pick<DemoJointSession, 'date' | 'startTime'>, today: string): string {
  return `${formatDayLabel(s.date, today)}${s.startTime ? ` · ${s.startTime}` : ''}`;
}

const NOT_LINKABLE = 'El entreno no existe, ya está completado o ya pertenece a otra quedada';

/** Mirrors `private.link_joint_workout`: creates the linked workout, or links and aligns an existing planned one. */
function organizerWorkout(db: DemoDb, organizerId: UUID, session: DemoJointSession, fromWorkoutId: UUID | null | undefined, clock: DemoClock) {
  if (!fromWorkoutId) {
    const created = jointWorkout(session, organizerId, clock);
    return { workouts: [...db.workouts, created], workoutId: created.id };
  }
  const existing = db.workouts.find((w) => w.id === fromWorkoutId && w.userId === organizerId);
  if (!existing || existing.status !== 'planned' || existing.jointSessionId !== null) {
    throw new RepositoryError('not_found', NOT_LINKABLE);
  }
  const linked: Workout = {
    ...existing,
    jointSessionId: session.id,
    date: session.date,
    startTime: session.startTime ?? existing.startTime,
    updatedAt: clock.now,
  };
  return { workouts: db.workouts.map((w) => (w.id === existing.id ? linked : w)), workoutId: existing.id };
}

export function proposeJoint(
  db: DemoDb,
  organizerId: UUID,
  draft: JointSessionDraft,
  clock: DemoClock,
): { db: DemoDb; sessionId: UUID } {
  assertJointDraft(draft);
  const invitees = [...new Set(draft.inviteeIds)].filter((id) => id !== organizerId);
  if (invitees.length === 0 || invitees.some((id) => !areFriends(db, organizerId, id))) {
    throw new RepositoryError('forbidden', 'Solo puedes invitar a amigos que hayan aceptado tu solicitud.');
  }
  const base: DemoJointSession = {
    id: clock.newId(),
    organizerId,
    sport: draft.sport,
    date: draft.date,
    startTime: draft.startTime ?? null,
    durationMin: Math.round(draft.durationMin),
    intensity: draft.intensity,
    title: draft.title.trim(),
    location: draft.location ?? null,
    notes: draft.notes ?? null,
    status: 'proposed',
    participants: [],
    createdAt: clock.now,
  };
  const linked = organizerWorkout(db, organizerId, base, draft.fromWorkoutId, clock);
  const participants: DemoParticipant[] = [
    { userId: organizerId, status: 'accepted', workoutId: linked.workoutId, respondedAt: clock.now },
    ...invitees.map((userId) => ({ userId, status: 'invited' as const, workoutId: null, respondedAt: null })),
  ];
  const session = { ...base, participants };
  const withSession: DemoDb = { ...db, workouts: linked.workouts, jointSessions: [...db.jointSessions, session] };
  const notified = invitees.reduce(
    (acc, userId) =>
      notify(acc, userId, {
        type: 'joint_invite',
        title: `${displayName(db, organizerId)} te invita a entrenar`,
        body: `${session.title} · ${when(session, clock.today)}`,
        data: { url: `/joint/${session.id}`, jointSessionId: session.id, fromUserId: organizerId },
      }, clock),
    withSession,
  );
  return { db: notified, sessionId: session.id };
}

function requireSession(db: DemoDb, id: UUID): DemoJointSession {
  const s = db.jointSessions.find((x) => x.id === id);
  if (!s) throw new RepositoryError('not_found', 'Esa quedada ya no existe.');
  return s;
}

function replaceSession(db: DemoDb, session: DemoJointSession): DemoDb {
  return { ...db, jointSessions: db.jointSessions.map((s) => (s.id === session.id ? session : s)) };
}

/** `joint_confirmed` feed event (organizer as actor; title only for 'full'). */
export function feedForJointConfirmed(db: DemoDb, s: DemoJointSession, clock: DemoClock, createdAt?: string): DemoDb {
  const visibility = profileOf(db, s.organizerId)?.visibility ?? 'full';
  if (visibility === 'busy') return db;
  const names = s.participants
    .filter((p) => p.status === 'accepted')
    .map((p) => displayName(db, p.userId))
    .sort((a, b) => a.localeCompare(b, 'es'));
  const payload = {
    jointSessionId: s.id,
    sport: s.sport,
    ...(visibility === 'full' ? { title: s.title } : {}),
    date: s.date,
    ...(s.startTime ? { startTime: s.startTime } : {}),
    durationMin: s.durationMin,
    participants: names,
  };
  return addFeedEvent(db, s.organizerId, 'joint_confirmed', payload, clock, createdAt);
}

function acceptParticipant(db: DemoDb, s: DemoJointSession, p: DemoParticipant, clock: DemoClock): DemoDb {
  const workout = p.workoutId ? null : jointWorkout(s, p.userId, clock);
  const participants = s.participants.map((x) =>
    x.userId === p.userId ? { ...x, status: 'accepted' as const, workoutId: workout?.id ?? x.workoutId, respondedAt: clock.now } : x,
  );
  const wasConfirmed = s.status === 'confirmed';
  const session: DemoJointSession = { ...s, participants, status: 'confirmed' };
  const next = replaceSession({ ...db, workouts: workout ? [...db.workouts, workout] : db.workouts }, session);
  if (wasConfirmed) return next;
  return feedForJointConfirmed(next, session, clock);
}

function declineParticipant(db: DemoDb, s: DemoJointSession, p: DemoParticipant, clock: DemoClock): DemoDb {
  const participants = s.participants.map((x) =>
    x.userId === p.userId ? { ...x, status: 'declined' as const, workoutId: null, respondedAt: clock.now } : x,
  );
  const workouts = db.workouts.filter((w) => !(w.id === p.workoutId && w.status === 'planned'));
  const stillConfirmed = participants.some((x) => x.userId !== s.organizerId && x.status === 'accepted');
  const session: DemoJointSession = { ...s, participants, status: stillConfirmed ? 'confirmed' : s.status === 'confirmed' ? 'proposed' : s.status };
  return replaceSession({ ...db, workouts }, session);
}

export function respondJoint(db: DemoDb, sessionId: UUID, userId: UUID, accept: boolean, clock: DemoClock): DemoDb {
  const s = requireSession(db, sessionId);
  if (s.status === 'cancelled') throw new RepositoryError('validation', 'Esta quedada se ha cancelado.');
  const p = s.participants.find((x) => x.userId === userId);
  if (!p || userId === s.organizerId) throw new RepositoryError('forbidden', 'No estás invitado a esta quedada.');
  if ((accept && p.status === 'accepted') || (!accept && p.status === 'declined')) return db;
  const next = accept ? acceptParticipant(db, s, p, clock) : declineParticipant(db, s, p, clock);
  const name = displayName(db, userId);
  return notify(next, s.organizerId, {
    type: 'joint_response',
    title: accept ? `${name} se apunta a «${s.title}»` : `${name} no puede ir a «${s.title}»`,
    body: when(s, clock.today),
    data: { url: `/joint/${s.id}`, jointSessionId: s.id, fromUserId: userId, accepted: accept },
  }, clock);
}

export function cancelJoint(db: DemoDb, sessionId: UUID, userId: UUID, clock: DemoClock): DemoDb {
  const s = requireSession(db, sessionId);
  if (s.organizerId !== userId) throw new RepositoryError('forbidden', 'Solo quien organiza la quedada puede cancelarla.');
  if (s.status === 'cancelled') return db;
  // Same as cancel_joint_session: drop the others' planned linked workouts, unlink every remaining one.
  const workouts = db.workouts
    .filter((w) => !(w.jointSessionId === s.id && w.userId !== userId && w.status === 'planned'))
    .map((w) => (w.jointSessionId === s.id ? { ...w, jointSessionId: null, updatedAt: clock.now } : w));
  const session: DemoJointSession = {
    ...s,
    status: 'cancelled',
    participants: s.participants.map((p) => ({ ...p, workoutId: null })),
  };
  const next = replaceSession({ ...db, workouts }, session);
  return s.participants
    .filter((p) => p.userId !== userId && p.status !== 'declined')
    .reduce(
      (acc, p) =>
        notify(acc, p.userId, {
          type: 'joint_cancelled',
          title: 'Quedada cancelada',
          body: `${displayName(db, userId)} ha cancelado «${s.title}» (${when(s, clock.today)}).`,
          data: { url: `/joint/${s.id}`, jointSessionId: s.id, fromUserId: userId },
        }, clock),
      next,
    );
}
