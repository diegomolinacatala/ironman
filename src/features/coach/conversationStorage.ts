/**
 * Persisted shape of the coach conversation (pure): messages plus the
 * in-flight marker, tagged with the account that owns them. Reads accept the
 * legacy format (a bare array of messages).
 */
import { parseHistory, trimHistory, type ChatMessage } from './chatModel';
import { parsePendingMarker, type PendingMarker } from './pendingMarker';

export const CONVERSATION_VERSION = 2;

export interface StoredConversation {
  version: typeof CONVERSATION_VERSION;
  ownerId: string | null;
  messages: ChatMessage[];
  pending: PendingMarker | null;
}

export interface RestoredConversation {
  messages: ChatMessage[];
  pending: PendingMarker | null;
}

const EMPTY: RestoredConversation = { messages: [], pending: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function serializeConversation(
  ownerId: string | null,
  messages: readonly ChatMessage[],
  pending: PendingMarker | null,
): StoredConversation {
  return { version: CONVERSATION_VERSION, ownerId, messages: trimHistory(messages), pending };
}

/** Restores what `serializeConversation` wrote; another account's data is ignored. */
export function parseStoredConversation(raw: unknown, ownerId: string | null): RestoredConversation {
  if (Array.isArray(raw)) return { messages: parseHistory(raw), pending: null };
  if (!isRecord(raw) || raw.version !== CONVERSATION_VERSION) return EMPTY;
  const storedOwner = typeof raw.ownerId === 'string' ? raw.ownerId : null;
  if (storedOwner !== null && ownerId !== null && storedOwner !== ownerId) return EMPTY;
  return { messages: parseHistory(raw.messages), pending: parsePendingMarker(raw.pending) };
}
