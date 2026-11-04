/**
 * Which friends a Talk message is about, so the coach request can carry their
 * (masked) calendars as `friendIds`. Pure.
 *
 * - A friend is mentioned by first name, display name or @username, as a whole
 *   word, ignoring case and accents ("alex" matches "Álex García").
 * - Generic words ("amigos", "juntos", "quedada"…) mean every accepted friend,
 *   unless the message also names someone (then only the named ones).
 * - Only accepted friends, at most MAX_FRIEND_IDS (the edge function's limit).
 */
import type { Friend, UUID } from '@/domain/types';
import { firstName } from '@/features/social/friendModel';

export const MAX_FRIEND_IDS = 5;
/** Names shorter than this never match on their own (initials, "Al"…). */
const MIN_NAME_LENGTH = 2;

/** Normalised words that mean "with my friends" without naming anyone. */
export const GENERIC_FRIEND_WORDS: readonly string[] = [
  'amigo',
  'amigos',
  'amiga',
  'amigas',
  'juntos',
  'juntas',
  'quedada',
  'quedadas',
  'quedar',
  'quedamos',
  'compañero',
  'compañeros',
  'compañera',
  'compañeras',
  'coincidir',
].map(normalize);

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (or whole-phrase) match on already normalised text. */
function containsTerm(haystack: string, term: string): boolean {
  if (term.length < MIN_NAME_LENGTH) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(haystack);
}

function friendTerms(friend: Friend): string[] {
  const { displayName, username } = friend.profile;
  const terms = [displayName, firstName(displayName), username, `@${username}`].map(normalize).filter((t) => t.length > 0);
  return [...new Set(terms)];
}

function accepted(friends: readonly Friend[]): Friend[] {
  return friends.filter((f) => f.status === 'accepted');
}

/** Accepted friends named in the message (by name or @username). */
function namedFriends(text: string, friends: readonly Friend[]): Friend[] {
  return accepted(friends).filter((f) => friendTerms(f).some((term) => containsTerm(text, term)));
}

function mentionsFriendsGenerically(text: string): boolean {
  return GENERIC_FRIEND_WORDS.some((word) => containsTerm(text, word));
}

/** Ids of the accepted friends a message is about (named first; generic words → all), max 5. */
export function friendIdsMentioned(message: string, friends: readonly Friend[]): UUID[] {
  const text = normalize(message);
  if (text.length === 0) return [];
  const named = namedFriends(text, friends);
  const chosen = named.length > 0 ? named : mentionsFriendsGenerically(text) ? accepted(friends) : [];
  return [...new Set(chosen.map((f) => f.profile.id))].slice(0, MAX_FRIEND_IDS);
}

/**
 * Friends for a message of the conversation: those of the message itself or,
 * for a follow-up that names nobody ("¿y el domingo?"), those of the most
 * recent of the previous `lookBack` messages that mentioned any.
 */
export function friendIdsForConversation(
  message: string,
  previousMessages: readonly string[],
  friends: readonly Friend[],
  lookBack = 2,
): UUID[] {
  const own = friendIdsMentioned(message, friends);
  if (own.length > 0) return own;
  for (const previous of previousMessages.slice(-lookBack).reverse()) {
    const ids = friendIdsMentioned(previous, friends);
    if (ids.length > 0) return ids;
  }
  return [];
}
