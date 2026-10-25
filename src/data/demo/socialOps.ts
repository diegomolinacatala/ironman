/**
 * Friends, profile search and feed in the demo DB — pure functions mirroring
 * the social RPCs (`send_friend_request`, `list_friends`, `list_feed`…).
 */
import type { FeedItem, Friend, Profile, PublicProfile, UUID } from '@/domain/types';

import { RepositoryError } from '../repository';
import { profileOf, type DemoClock, type DemoDb, type DemoFriendship } from './db';
import { displayName, notify } from './events';

export function toPublicProfile(p: Profile): PublicProfile {
  return { id: p.id, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl, sports: p.sports };
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function searchProfilesIn(db: DemoDb, me: UUID, query: string): PublicProfile[] {
  const q = normalize(query.trim().replace(/^@/, ''));
  if (q.length < 2) return [];
  return db.profiles
    .filter((p) => p.id !== me && (normalize(p.username).includes(q) || normalize(p.displayName).includes(q)))
    .slice(0, 20)
    .map(toPublicProfile);
}

function otherParty(f: DemoFriendship, me: UUID): UUID {
  return f.requesterId === me ? f.addresseeId : f.requesterId;
}

export function friendshipBetween(db: DemoDb, a: UUID, b: UUID): DemoFriendship | null {
  return (
    db.friendships.find(
      (f) => (f.requesterId === a && f.addresseeId === b) || (f.requesterId === b && f.addresseeId === a),
    ) ?? null
  );
}

export function listFriendsFor(db: DemoDb, me: UUID): Friend[] {
  return db.friendships
    .filter((f) => (f.requesterId === me || f.addresseeId === me) && (f.status === 'accepted' || f.status === 'pending'))
    .flatMap((f) => {
      const profile = profileOf(db, otherParty(f, me));
      if (!profile) return [];
      const direction: Friend['direction'] =
        f.status === 'accepted' ? 'mutual' : f.requesterId === me ? 'outgoing' : 'incoming';
      const visibility = f.status === 'accepted' ? profile.visibility : null;
      return [
        { friendshipId: f.id, profile: toPublicProfile(profile), status: f.status, direction, visibility, createdAt: f.createdAt },
      ];
    })
    .sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName, 'es'));
}

function accept(db: DemoDb, f: DemoFriendship, clock: DemoClock): DemoDb {
  const updated: DemoFriendship = { ...f, status: 'accepted', respondedAt: clock.now };
  const next = { ...db, friendships: db.friendships.map((x) => (x.id === f.id ? updated : x)) };
  return notify(next, f.requesterId, {
    type: 'friend_accepted',
    title: `${displayName(db, f.addresseeId)} ha aceptado tu solicitud`,
    body: 'Ya podéis ver vuestros calendarios y quedar para entrenar.',
    data: { url: `/friends/${f.addresseeId}`, friendshipId: f.id, friendId: f.addresseeId },
  }, clock);
}

export function sendRequest(
  db: DemoDb,
  me: UUID,
  username: string,
  clock: DemoClock,
): { db: DemoDb; friendshipId: UUID; targetId: UUID; accepted: boolean } {
  const clean = username.trim().replace(/^@/, '').toLowerCase();
  const target = db.profiles.find((p) => p.username === clean);
  if (!target) throw new RepositoryError('not_found', `No existe ningún usuario @${clean}.`);
  if (target.id === me) throw new RepositoryError('validation', 'No puedes enviarte una solicitud a ti mismo.');
  const existing = friendshipBetween(db, me, target.id);
  if (existing?.status === 'accepted') throw new RepositoryError('conflict', `Ya eres amigo de ${target.displayName}.`);
  if (existing?.status === 'pending' && existing.addresseeId === me) {
    return { db: accept(db, existing, clock), friendshipId: existing.id, targetId: target.id, accepted: true };
  }
  if (existing?.status === 'pending') throw new RepositoryError('conflict', 'Ya le has enviado una solicitud.');
  const friendship: DemoFriendship = {
    id: clock.newId(),
    requesterId: me,
    addresseeId: target.id,
    status: 'pending',
    createdAt: clock.now,
    respondedAt: null,
  };
  const others = db.friendships.filter((f) => f.id !== existing?.id);
  const sender = profileOf(db, me);
  const next = notify({ ...db, friendships: [...others, friendship] }, target.id, {
    type: 'friend_request',
    title: 'Nueva solicitud de amistad',
    body: `${sender?.displayName ?? 'Alguien'} (@${sender?.username ?? ''}) quiere entrenar contigo.`,
    data: { url: '/together', friendshipId: friendship.id, fromUserId: me },
  }, clock);
  return { db: next, friendshipId: friendship.id, targetId: target.id, accepted: false };
}

export function respondRequest(db: DemoDb, me: UUID, friendshipId: UUID, acceptIt: boolean, clock: DemoClock): DemoDb {
  const f = db.friendships.find((x) => x.id === friendshipId);
  if (!f) throw new RepositoryError('not_found', 'Esa solicitud ya no existe.');
  if (f.addresseeId !== me) throw new RepositoryError('forbidden', 'Solo quien recibe la solicitud puede responderla.');
  if (f.status !== 'pending') return db;
  if (acceptIt) return accept(db, f, clock);
  const declined: DemoFriendship = { ...f, status: 'declined', respondedAt: clock.now };
  return { ...db, friendships: db.friendships.map((x) => (x.id === f.id ? declined : x)) };
}

export function removeFriendship(db: DemoDb, me: UUID, friendshipId: UUID): DemoDb {
  const f = db.friendships.find((x) => x.id === friendshipId);
  if (!f) return db;
  if (f.requesterId !== me && f.addresseeId !== me) throw new RepositoryError('forbidden', 'No puedes borrar esta amistad.');
  return { ...db, friendships: db.friendships.filter((x) => x.id !== friendshipId) };
}

/** Me + accepted friends whose visibility is not 'busy' (mirrors `list_feed`). */
function visibleActors(db: DemoDb, me: UUID): Set<UUID> {
  const friends = db.friendships
    .filter((f) => f.status === 'accepted' && (f.requesterId === me || f.addresseeId === me))
    .map((f) => otherParty(f, me))
    .filter((id) => profileOf(db, id)?.visibility !== 'busy');
  return new Set([me, ...friends]);
}

/** Friends with 'summary' visibility never expose titles/names in the feed. */
function maskedPayload(payload: Record<string, unknown>, actor: Profile, me: UUID): Record<string, unknown> {
  if (actor.id === me || actor.visibility !== 'summary') return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'title' && key !== 'name'));
}

export function feedFor(db: DemoDb, me: UUID, limit: number): FeedItem[] {
  const actors = visibleActors(db, me);
  return db.feed
    .filter((e) => actors.has(e.actorId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .flatMap((e) => {
      const actor = profileOf(db, e.actorId);
      if (!actor) return [];
      const kudos = db.kudos.filter((k) => k.eventId === e.id);
      return [{
        id: e.id,
        actor: toPublicProfile(actor),
        type: e.type,
        payload: maskedPayload(e.payload, actor, me),
        createdAt: e.createdAt,
        kudosCount: kudos.length,
        hasKudoed: kudos.some((k) => k.userId === me),
      }];
    });
}

export function toggleKudosIn(db: DemoDb, me: UUID, eventId: UUID, clock: DemoClock): DemoDb {
  const event = db.feed.find((e) => e.id === eventId);
  if (!event || !visibleActors(db, me).has(event.actorId)) {
    throw new RepositoryError('not_found', 'Esa actividad ya no está disponible.');
  }
  const has = db.kudos.some((k) => k.eventId === eventId && k.userId === me);
  if (has) return { ...db, kudos: db.kudos.filter((k) => !(k.eventId === eventId && k.userId === me)) };
  const next = { ...db, kudos: [...db.kudos, { eventId, userId: me, createdAt: clock.now }] };
  if (event.actorId === me) return next;
  return notify(next, event.actorId, {
    type: 'kudos',
    title: `${displayName(db, me)} te ha dado kudos`,
    body: kudosBody(event.type, event.payload),
    data: { url: '/together', eventId, fromUserId: me },
  }, clock);
}

function kudosBody(type: string, payload: Record<string, unknown>): string {
  if (type === 'workout_completed') return typeof payload.title === 'string' ? `Por «${payload.title}»` : 'Por tu entreno';
  if (type === 'race_added') return 'Por tu nueva carrera';
  if (type === 'joint_confirmed') return 'Por vuestra quedada';
  return 'Por tu actividad';
}
