/**
 * "Juntos" v3 in the demo DB — pure transitions mirroring migration
 * 20261104000100: open quedadas (list + join), organizer edits, comments,
 * "entrenasteis juntos" and friends' upcoming races.
 */
import { formatDayLabel } from '@/domain/dates';
import type {
  DateRange,
  FriendRace,
  JointComment,
  JointSession,
  JointSessionPatch,
  UUID,
  Workout,
} from '@/domain/types';

import { RepositoryError } from '../repository';
import { profileOf, type DemoClock, type DemoDb, type DemoJointSession } from './db';
import { addFeedEvent, displayName, notify } from './events';
import { areFriends, getJointFor, respondJoint, toJointSession } from './jointOps';
import { isBlocked } from './socialOps';
import { assertJointDraft } from './validation';

export const MAX_COMMENT_LENGTH = 500;
const MAX_PARTICIPANTS = 11;

function requireSession(db: DemoDb, id: UUID): DemoJointSession {
  const s = db.jointSessions.find((x) => x.id === id);
  if (!s) throw new RepositoryError('not_found', 'Esa quedada ya no existe.');
  return s;
}

function isParticipant(s: DemoJointSession, userId: UUID): boolean {
  return s.organizerId === userId || s.participants.some((p) => p.userId === userId);
}

function when(s: Pick<DemoJointSession, 'date' | 'startTime'>, today: string): string {
  return `${formatDayLabel(s.date, today)}${s.startTime ? ` · ${s.startTime}` : ''}`;
}

function replaceSession(db: DemoDb, session: DemoJointSession): DemoDb {
  return { ...db, jointSessions: db.jointSessions.map((s) => (s.id === session.id ? session : s)) };
}

function notifyOthers(
  db: DemoDb,
  s: DemoJointSession,
  except: UUID,
  input: { type: 'joint_updated' | 'joint_comment'; title: string; body: string },
  clock: DemoClock,
): DemoDb {
  return s.participants
    .filter((p) => p.userId !== except && p.status !== 'declined')
    .filter((p) => input.type !== 'joint_comment' || !isBlocked(db, p.userId, except))
    .reduce(
      (acc, p) => notify(acc, p.userId, { ...input, data: { url: `/joint/${s.id}`, jointSessionId: s.id, fromUserId: except } }, clock),
      db,
    );
}

// ---------------------------------------------------------------------------
// Open quedadas
// ---------------------------------------------------------------------------

/** Friends' open quedadas I am not in (participants I don't know are left out). */
export function listOpenFor(db: DemoDb, me: UUID, range: DateRange, today: string): JointSession[] {
  const from = range.from > today ? range.from : today;
  return db.jointSessions
    .filter(
      (s) =>
        s.isOpen === true &&
        s.status !== 'cancelled' &&
        s.date >= from &&
        s.date <= range.to &&
        areFriends(db, me, s.organizerId) &&
        !s.participants.some((p) => p.userId === me && p.status !== 'declined'),
    )
    .sort((a, b) => (a.date === b.date ? (a.startTime ?? '').localeCompare(b.startTime ?? '') : a.date < b.date ? -1 : 1))
    .map((s) => {
      const session = toJointSession(db, s);
      return {
        ...session,
        participants: session.participants.filter((p) => p.userId === s.organizerId || areFriends(db, me, p.userId)),
      };
    });
}

function linkedWorkout(s: DemoJointSession, userId: UUID, clock: DemoClock): Workout {
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

export function joinJoint(db: DemoDb, sessionId: UUID, me: UUID, clock: DemoClock): DemoDb {
  const s = requireSession(db, sessionId);
  if (s.isOpen !== true || !areFriends(db, me, s.organizerId)) throw new RepositoryError('not_found', 'Esa quedada ya no existe.');
  if (s.status === 'cancelled') throw new RepositoryError('conflict', 'Esta quedada se ha cancelado.');
  if (s.date < clock.today) throw new RepositoryError('conflict', 'Esta quedada ya ha pasado.');
  const existing = s.participants.find((p) => p.userId === me);
  if (existing) return existing.status === 'accepted' && existing.workoutId ? db : respondJoint(db, s.id, me, true, clock);
  if (s.participants.length >= MAX_PARTICIPANTS) throw new RepositoryError('conflict', 'Esta quedada ya está completa.');

  const workout = linkedWorkout(s, me, clock);
  const session: DemoJointSession = {
    ...s,
    status: 'confirmed',
    participants: [...s.participants, { userId: me, status: 'accepted', workoutId: workout.id, respondedAt: clock.now }],
  };
  const next = replaceSession({ ...db, workouts: [...db.workouts, workout] }, session);
  return notify(next, s.organizerId, {
    type: 'joint_response',
    title: `${displayName(db, me)} se apunta a «${s.title}»`,
    body: when(s, clock.today),
    data: { url: `/joint/${s.id}`, jointSessionId: s.id, fromUserId: me, accepted: true },
  }, clock);
}

// ---------------------------------------------------------------------------
// Edit (organizer)
// ---------------------------------------------------------------------------

export function updateJoint(db: DemoDb, sessionId: UUID, me: UUID, patch: JointSessionPatch, clock: DemoClock): DemoDb {
  const s = requireSession(db, sessionId);
  if (!isParticipant(s, me)) throw new RepositoryError('not_found', 'Esa quedada ya no existe.');
  if (s.organizerId !== me) throw new RepositoryError('forbidden', 'Solo quien organiza la quedada puede cambiarla.');
  if (s.status === 'cancelled') throw new RepositoryError('conflict', 'Esta quedada se ha cancelado.');
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as JointSessionPatch;
  if (Object.keys(defined).length === 0) throw new RepositoryError('validation', 'No hay cambios que guardar.');
  const merged: DemoJointSession = {
    ...s,
    ...defined,
    title: (defined.title ?? s.title).trim(),
    location: defined.location === undefined ? s.location : defined.location?.trim() || null,
    notes: defined.notes === undefined ? s.notes : defined.notes?.trim() || null,
    durationMin: Math.round(defined.durationMin ?? s.durationMin),
  };
  assertJointDraft({ ...merged, inviteeIds: ['x'] });
  if (merged.date < clock.today) throw new RepositoryError('validation', 'No puedes mover la quedada al pasado.');

  const workouts = db.workouts.map((w) =>
    w.jointSessionId === s.id && w.status === 'planned'
      ? {
          ...w,
          date: merged.date,
          startTime: merged.startTime ?? w.startTime,
          sport: merged.sport,
          title: merged.title,
          durationMin: merged.durationMin,
          intensity: merged.intensity,
          description: [merged.location, merged.notes].filter(Boolean).join(' · ') || null,
          updatedAt: clock.now,
        }
      : w,
  );
  const next = openedNotified(replaceSession({ ...db, workouts }, merged), s, merged, clock);
  const movedWhen = merged.date !== s.date || merged.startTime !== s.startTime;
  return notifyOthers(next, merged, me, {
    type: 'joint_updated',
    title: `${displayName(db, me)} ha cambiado «${merged.title}»`,
    body: movedWhen ? `Ahora es ${when(merged, clock.today)}.` : `${when(merged, clock.today)} · ${merged.location ?? 'mira los detalles'}`,
  }, clock);
}

/** A closed quedada that becomes open: friends not in it yet hear about it once. */
function openedNotified(db: DemoDb, before: DemoJointSession, after: DemoJointSession, clock: DemoClock): DemoDb {
  if (before.isOpen === true || after.isOpen !== true) return db;
  const friends = db.friendships
    .filter((f) => f.status === 'accepted' && (f.requesterId === after.organizerId || f.addresseeId === after.organizerId))
    .map((f) => (f.requesterId === after.organizerId ? f.addresseeId : f.requesterId))
    .filter((id) => !after.participants.some((p) => p.userId === id));
  return friends.reduce(
    (acc, userId) =>
      notify(acc, userId, {
        type: 'joint_open',
        title: `${displayName(db, after.organizerId)} abre una quedada`,
        body: `${after.title} · ${when(after, clock.today)}. Apúntate si te encaja.`,
        data: { url: `/joint/${after.id}`, jointSessionId: after.id, fromUserId: after.organizerId },
      }, clock),
    db,
  );
}

export function updatedJointFor(db: DemoDb, me: UUID, id: UUID): JointSession {
  const session = getJointFor(db, me, id);
  if (!session) throw new RepositoryError('unknown', 'No se ha podido leer la quedada.');
  return session;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function listCommentsFor(db: DemoDb, me: UUID, sessionId: UUID): JointComment[] {
  const s = requireSession(db, sessionId);
  const declined = s.participants.some((p) => p.userId === me && p.status === 'declined');
  if (!isParticipant(s, me) || declined) throw new RepositoryError('not_found', 'Esa quedada ya no existe.');
  return db.jointComments
    .filter((c) => c.sessionId === sessionId && (c.userId === me || !isBlocked(db, c.userId, me)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({ ...c, displayName: displayName(db, c.userId) }));
}

export function addComment(
  db: DemoDb,
  me: UUID,
  sessionId: UUID,
  body: string,
  clock: DemoClock,
): { db: DemoDb; comment: JointComment } {
  const s = requireSession(db, sessionId);
  if (!isParticipant(s, me)) throw new RepositoryError('not_found', 'Esa quedada ya no existe.');
  if (s.participants.some((p) => p.userId === me && p.status === 'declined')) {
    throw new RepositoryError('forbidden', 'Has dicho que no vas a esta quedada.');
  }
  const text = body.trim();
  if (!text) throw new RepositoryError('validation', 'Escribe un mensaje.');
  if (text.length > MAX_COMMENT_LENGTH) throw new RepositoryError('validation', 'Mensaje demasiado largo (máximo 500 caracteres).');
  const comment: JointComment = {
    id: clock.newId(),
    sessionId,
    userId: me,
    displayName: displayName(db, me),
    body: text,
    createdAt: clock.now,
  };
  const next = { ...db, jointComments: [...db.jointComments, comment] };
  return {
    db: notifyOthers(next, s, me, { type: 'joint_comment', title: `${displayName(db, me)} en «${s.title}»`, body: text }, clock),
    comment,
  };
}

// ---------------------------------------------------------------------------
// "Entrenasteis juntos" + friends' races
// ---------------------------------------------------------------------------

/** Mirrors `private.on_joint_workout_completed`: one event once every accepted participant (2+) is done. */
export function feedForJointCompletion(db: DemoDb, workout: Workout, clock: DemoClock): DemoDb {
  if (!workout.jointSessionId || workout.status !== 'completed') return db;
  const s = db.jointSessions.find((x) => x.id === workout.jointSessionId);
  if (!s || s.status === 'cancelled') return db;
  const accepted = s.participants.filter((p) => p.status === 'accepted');
  if (accepted.length < 2) return db;
  const done = accepted.every((p) => db.workouts.some((w) => w.id === p.workoutId && w.status === 'completed'));
  if (!done) return db;
  if (db.feed.some((e) => e.type === 'joint_completed' && e.payload.jointSessionId === s.id)) return db;
  const visibility = profileOf(db, s.organizerId)?.visibility ?? 'full';
  if (visibility === 'busy') return db;
  const names = accepted.map((p) => displayName(db, p.userId)).sort((a, b) => a.localeCompare(b, 'es'));
  return addFeedEvent(db, s.organizerId, 'joint_completed', {
    jointSessionId: s.id,
    sport: s.sport,
    ...(visibility === 'full' ? { title: s.title } : {}),
    date: s.date,
    durationMin: s.durationMin,
    participants: names,
  }, clock);
}

export function friendRacesFor(db: DemoDb, me: UUID, today: string): FriendRace[] {
  return db.races
    .filter((r) => r.userId !== me && r.date >= today && areFriends(db, me, r.userId))
    .flatMap((r): FriendRace[] => {
      const friend = profileOf(db, r.userId);
      if (!friend || friend.visibility === 'busy') return [];
      return [{
        friendId: friend.id,
        displayName: friend.displayName,
        raceId: r.id,
        name: friend.visibility === 'full' ? r.name : null,
        date: r.date,
        distance: r.distance,
        priority: r.priority,
      }];
    })
    .sort((a, b) => (a.date === b.date ? a.displayName.localeCompare(b.displayName, 'es') : a.date < b.date ? -1 : 1));
}
