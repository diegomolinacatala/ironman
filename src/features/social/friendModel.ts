/**
 * Pure helpers over the friends list (relations, splits, lookups).
 */
import type { Friend, UUID } from '@/domain/types';

export type FriendRelation =
  | { kind: 'self' }
  | { kind: 'friends'; friendshipId: UUID }
  | { kind: 'outgoing'; friendshipId: UUID }
  | { kind: 'incoming'; friendshipId: UUID }
  | { kind: 'none' };

/** Relation between me and a profile found in search. */
export function relationTo(profileId: UUID, friends: readonly Friend[], myId: UUID | null): FriendRelation {
  if (myId && profileId === myId) return { kind: 'self' };
  const match = friends.find((f) => f.profile.id === profileId && f.status !== 'declined');
  if (!match) return { kind: 'none' };
  if (match.status === 'accepted') return { kind: 'friends', friendshipId: match.friendshipId };
  if (match.status === 'pending' && match.direction === 'incoming') {
    return { kind: 'incoming', friendshipId: match.friendshipId };
  }
  if (match.status === 'pending') return { kind: 'outgoing', friendshipId: match.friendshipId };
  return { kind: 'none' };
}

export interface FriendSplit {
  accepted: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}

export function splitFriends(friends: readonly Friend[] | undefined): FriendSplit {
  const list = friends ?? [];
  const byName = (a: Friend, b: Friend) => a.profile.displayName.localeCompare(b.profile.displayName, 'es');
  return {
    accepted: list.filter((f) => f.status === 'accepted').sort(byName),
    incoming: list.filter((f) => f.status === 'pending' && f.direction === 'incoming').sort(byName),
    outgoing: list.filter((f) => f.status === 'pending' && f.direction !== 'incoming').sort(byName),
  };
}

export function findAcceptedFriend(friends: readonly Friend[] | undefined, profileId: UUID | undefined): Friend | null {
  if (!profileId) return null;
  return (friends ?? []).find((f) => f.status === 'accepted' && f.profile.id === profileId) ?? null;
}

/** First name for compact copy ("Álex" from "Álex García"). */
export function firstName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : displayName;
}
