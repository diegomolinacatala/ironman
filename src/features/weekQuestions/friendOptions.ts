import type { Friend, UUID } from '@/domain/types';
import { firstName, splitFriends } from '@/features/social/friendModel';

/** A friend with the app, as an answer chip. */
export interface FriendOption {
  id: UUID;
  name: string;
}

/** Chips shown at most (the rest are in Juntos › Proponer quedada). */
export const MAX_FRIEND_CHIPS = 6;

/** Accepted friends by name, as chips (first names; full name when two share it). */
export function friendOptions(friends: readonly Friend[] | undefined): FriendOption[] {
  const accepted = splitFriends(friends).accepted;
  const firsts = accepted.map((f) => firstName(f.profile.displayName));
  return accepted.slice(0, MAX_FRIEND_CHIPS).map((f, i) => {
    const first = firsts[i] ?? f.profile.displayName;
    const shared = firsts.filter((n) => n === first).length > 1;
    return { id: f.profile.id, name: shared ? f.profile.displayName : first };
  });
}
