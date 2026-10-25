import type { DateRange, FriendWeekItem, JointSession, JointSessionDraft, UUID } from '@/domain/types';

import { RepositoryError, type Repository } from '../../repository';
import { profileOf } from '../db';
import { maskFriendWeek } from '../friendWeek';
import { areFriends, cancelJoint, getJointFor, listJointFor, proposeJoint, respondJoint } from '../jointOps';
import {
  feedFor,
  listFriendsFor,
  removeFriendship,
  respondRequest,
  searchProfilesIn,
  sendRequest,
  toggleKudosIn,
} from '../socialOps';
import { assertFriendRange } from '../validation';
import { requireMe, type DemoDeps } from './common';

type SocialMethods = Pick<
  Repository,
  | 'searchProfiles'
  | 'listFriends'
  | 'sendFriendRequest'
  | 'respondFriendRequest'
  | 'removeFriend'
  | 'getFriendWeek'
  | 'listJointSessions'
  | 'getJointSession'
  | 'proposeJointSession'
  | 'respondJointSession'
  | 'cancelJointSession'
  | 'listFeed'
  | 'toggleKudos'
>;

/** Simulated friends: they accept quedada invites after `friendDelayMs`. */
function simulateInviteesAccept({ store, friendDelayMs }: DemoDeps, sessionId: UUID): void {
  store.later(friendDelayMs, async () => {
    await store.update((db, clock) => {
      const session = db.jointSessions.find((s) => s.id === sessionId);
      if (!session || session.status === 'cancelled') return { db, result: undefined };
      const pending = session.participants.filter((p) => p.status === 'invited' && p.userId !== db.meId);
      const next = pending.reduce((acc, p) => respondJoint(acc, sessionId, p.userId, true, clock), db);
      return { db: next, result: undefined };
    });
    store.emit(['joint_sessions', 'workouts', 'notifications', 'feed']);
  });
}

/** Simulated friends accept friend requests after `friendDelayMs`. */
function simulateRequestAccepted({ store, friendDelayMs }: DemoDeps, friendshipId: UUID): void {
  store.later(friendDelayMs, async () => {
    await store.update((db, clock) => {
      const f = db.friendships.find((x) => x.id === friendshipId);
      if (!f || f.status !== 'pending') return { db, result: undefined };
      return { db: respondRequest(db, f.addresseeId, friendshipId, true, clock), result: undefined };
    });
    store.emit(['friends', 'notifications', 'feed']);
  });
}

function friendMethods(
  deps: DemoDeps,
): Pick<Repository, 'searchProfiles' | 'listFriends' | 'sendFriendRequest' | 'respondFriendRequest' | 'removeFriend' | 'getFriendWeek'> {
  const { store } = deps;
  return {
    async searchProfiles(query: string) {
      const me = await requireMe(store);
      return searchProfilesIn(await store.read(), me, query);
    },
    async listFriends() {
      const me = await requireMe(store);
      return listFriendsFor(await store.read(), me);
    },
    async sendFriendRequest(username: string) {
      const me = await requireMe(store);
      const sent = await store.update((db, clock) => {
        const r = sendRequest(db, me, username, clock);
        return { db: r.db, result: r };
      });
      if (!sent.accepted) simulateRequestAccepted(deps, sent.friendshipId);
    },
    async respondFriendRequest(friendshipId: UUID, accept: boolean) {
      const me = await requireMe(store);
      await store.update((db, clock) => ({ db: respondRequest(db, me, friendshipId, accept, clock), result: undefined }));
    },
    async removeFriend(friendshipId: UUID) {
      const me = await requireMe(store);
      await store.update((db) => ({ db: removeFriendship(db, me, friendshipId), result: undefined }));
    },
    async getFriendWeek(friendId: UUID, range: DateRange): Promise<FriendWeekItem[]> {
      assertFriendRange(range);
      const me = await requireMe(store);
      const db = await store.read();
      const friend = profileOf(db, friendId);
      if (!friend || !areFriends(db, me, friendId)) {
        throw new RepositoryError('forbidden', 'Solo puedes ver el calendario de tus amigos.');
      }
      return maskFriendWeek({
        visibility: friend.visibility,
        range,
        workouts: db.workouts.filter((w) => w.userId === friendId),
        busyBlocks: db.busyBlocks.filter((b) => b.userId === friendId),
        lifeEvents: db.lifeEvents.filter((e) => e.userId === friendId),
      });
    },
  };
}

function jointMethods(
  deps: DemoDeps,
): Pick<Repository, 'listJointSessions' | 'getJointSession' | 'proposeJointSession' | 'respondJointSession' | 'cancelJointSession'> {
  const { store } = deps;
  return {
    async listJointSessions(range: DateRange) {
      const me = await requireMe(store);
      return listJointFor(await store.read(), me, range);
    },
    async getJointSession(id: UUID) {
      const me = await requireMe(store);
      return getJointFor(await store.read(), me, id);
    },
    async proposeJointSession(draft: JointSessionDraft): Promise<JointSession> {
      const me = await requireMe(store);
      const session = await store.update((db, clock) => {
        const r = proposeJoint(db, me, draft, clock);
        const created = getJointFor(r.db, me, r.sessionId);
        if (!created) throw new RepositoryError('unknown', 'No se ha podido crear la quedada.');
        return { db: r.db, result: created };
      });
      simulateInviteesAccept(deps, session.id);
      return session;
    },
    async respondJointSession(id: UUID, accept: boolean) {
      const me = await requireMe(store);
      await store.update((db, clock) => ({ db: respondJoint(db, id, me, accept, clock), result: undefined }));
    },
    async cancelJointSession(id: UUID) {
      const me = await requireMe(store);
      await store.update((db, clock) => ({ db: cancelJoint(db, id, me, clock), result: undefined }));
    },
  };
}

function feedMethods({ store }: DemoDeps): Pick<Repository, 'listFeed' | 'toggleKudos'> {
  return {
    async listFeed(limit = 30) {
      const me = await requireMe(store);
      return feedFor(await store.read(), me, limit);
    },
    async toggleKudos(feedItemId: UUID) {
      const me = await requireMe(store);
      await store.update((db, clock) => ({ db: toggleKudosIn(db, me, feedItemId, clock), result: undefined }));
    },
  };
}

export function socialDemo(deps: DemoDeps): SocialMethods {
  return { ...friendMethods(deps), ...jointMethods(deps), ...feedMethods(deps) };
}
