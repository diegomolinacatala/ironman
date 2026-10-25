/**
 * Push dispatch: claims unsent notifications (last 24 h), maps them to Expo
 * messages for every device of the owner, respects `notification_prefs.social`
 * for social types, records the outcome and drops DeviceNotRegistered tokens
 * (from tickets here; from receipts in receipts.ts, fed by the ok tickets).
 * Claiming first (pushed_at = now where null) prevents double sends when the
 * trigger call and the cron sweep overlap.
 */
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { UUID } from '../types.ts';
import { chunk, EXPO_CHUNK_SIZE, ExpoTransportError, isExpoPushToken, sendExpoChunk } from './expo.ts';
import type { ExpoMessage, ExpoTicket, FetchFn } from './expo.ts';
import type { ReceiptTracker, SentTicket } from './receipts.ts';

/** Types silenced by `notification_prefs.social = false`. Invites, cancellations and plan proposals always go out. */
export const SOCIAL_TYPES: ReadonlySet<string> = new Set(['friend_request', 'friend_accepted', 'friend_completed', 'kudos']);

export interface PendingNotification {
  id: UUID;
  userId: UUID;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushOutcome {
  id: UUID;
  error: string | null;
}

export interface PushStore {
  listUnsent(sinceIso: string, limit: number): Promise<PendingNotification[]>;
  /** Atomically sets pushed_at where still null; returns the ids this call owns. */
  claim(ids: UUID[]): Promise<UUID[]>;
  /** Puts notifications back in the queue after a transient failure. */
  release(ids: UUID[]): Promise<void>;
  listTokens(userIds: UUID[]): Promise<{ token: string; userId: UUID }[]>;
  /** user id → notification_prefs.social (missing users default to true). */
  socialPrefs(userIds: UUID[]): Promise<Map<UUID, boolean>>;
  recordOutcomes(outcomes: PushOutcome[]): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
  /** Deletes tokens whose last_seen_at is older than `beforeIso`; returns how many. */
  pruneStaleTokens(beforeIso: string): Promise<number>;
}

export interface DispatchDeps {
  store: PushStore;
  fetch: FetchFn;
  expoAccessToken?: string;
  now: () => Date;
  logger: Logger;
  /** Collects the ok tickets so their receipts can be checked later (per isolate). */
  receipts?: ReceiptTracker;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  requeued: number;
  tokensRemoved: number;
}

interface Envelope {
  notificationId: UUID;
  message: ExpoMessage;
}

export function toExpoMessage(n: PendingNotification, token: string): ExpoMessage {
  return {
    to: token,
    title: n.title,
    body: n.body,
    data: { ...n.data, notificationId: n.id, type: n.type },
    sound: 'default',
  };
}

function plan(
  pending: readonly PendingNotification[],
  tokens: readonly { token: string; userId: UUID }[],
  prefs: ReadonlyMap<UUID, boolean>,
): { envelopes: Envelope[]; skipped: PushOutcome[] } {
  const envelopes: Envelope[] = [];
  const skipped: PushOutcome[] = [];
  for (const n of pending) {
    if (SOCIAL_TYPES.has(n.type) && prefs.get(n.userId) === false) {
      skipped.push({ id: n.id, error: 'omitida: avisos sociales desactivados' });
      continue;
    }
    const mine = tokens.filter((t) => t.userId === n.userId && isExpoPushToken(t.token));
    if (mine.length === 0) {
      skipped.push({ id: n.id, error: 'omitida: sin dispositivos registrados' });
      continue;
    }
    mine.forEach((t) => envelopes.push({ notificationId: n.id, message: toExpoMessage(n, t.token) }));
  }
  return { envelopes, skipped };
}

export interface TicketSummary {
  outcomes: PushOutcome[];
  deadTokens: string[];
  /** Successful sends whose receipt is still to be checked. */
  sent: SentTicket[];
}

/** Folds per-device tickets into one outcome per notification. */
export function summarizeTickets(envelopes: readonly Envelope[], tickets: readonly ExpoTicket[]): TicketSummary {
  const byNotification = new Map<UUID, { ok: boolean; error: string | null }>();
  const deadTokens: string[] = [];
  const sent: SentTicket[] = [];
  envelopes.forEach((env, i) => {
    const ticket = tickets[i] ?? { status: 'error', message: 'Sin respuesta de Expo' };
    const prev = byNotification.get(env.notificationId) ?? { ok: false, error: null };
    if (ticket.status === 'ok') {
      byNotification.set(env.notificationId, { ok: true, error: null });
      sent.push({ ticketId: ticket.id, token: env.message.to, notificationId: env.notificationId });
      return;
    }
    if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(env.message.to);
    byNotification.set(env.notificationId, prev.ok ? prev : { ok: false, error: (prev.error ?? ticket.message).slice(0, 300) });
  });
  const outcomes = [...byNotification.entries()].map(([id, r]) => ({ id, error: r.ok ? null : r.error ?? 'Error de Expo' }));
  return { outcomes, deadTokens, sent };
}

async function sendAll(deps: DispatchDeps, envelopes: readonly Envelope[]): Promise<TicketSummary & { requeue: UUID[] }> {
  const outcomes: PushOutcome[] = [];
  const deadTokens: string[] = [];
  const sent: SentTicket[] = [];
  const requeue: UUID[] = [];
  for (const part of chunk(envelopes, EXPO_CHUNK_SIZE)) {
    try {
      const tickets = await sendExpoChunk(deps.fetch, part.map((e) => e.message), deps.expoAccessToken);
      const summary = summarizeTickets(part, tickets);
      outcomes.push(...summary.outcomes);
      deadTokens.push(...summary.deadTokens);
      sent.push(...summary.sent);
    } catch (error) {
      const ids = [...new Set(part.map((e) => e.notificationId))];
      const retryable = error instanceof ExpoTransportError && error.retryable;
      deps.logger.warn('expo chunk failed', { size: part.length, retryable, ...errorInfo(error) });
      ids.forEach((id) => outcomes.push({ id, error: error instanceof Error ? error.message.slice(0, 300) : 'Error de Expo' }));
      if (retryable) requeue.push(...ids);
    }
  }
  return { outcomes, deadTokens, sent, requeue };
}

export async function dispatchPending(deps: DispatchDeps, opts: { limit?: number } = {}): Promise<DispatchSummary> {
  const since = new Date(deps.now().getTime() - 24 * 3600_000).toISOString();
  const pending = await deps.store.listUnsent(since, opts.limit ?? 300);
  const claimedIds = new Set(pending.length ? await deps.store.claim(pending.map((n) => n.id)) : []);
  const claimed = pending.filter((n) => claimedIds.has(n.id));
  if (claimed.length === 0) return { claimed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0, tokensRemoved: 0 };
  const userIds = [...new Set(claimed.map((n) => n.userId))];
  const [tokens, prefs] = await Promise.all([deps.store.listTokens(userIds), deps.store.socialPrefs(userIds)]);
  const { envelopes, skipped } = plan(claimed, tokens, prefs);
  const { outcomes, deadTokens, sent, requeue } = await sendAll(deps, envelopes);
  deps.receipts?.track(sent, deps.now().getTime());
  await deps.store.recordOutcomes([...skipped, ...outcomes]);
  if (requeue.length) await deps.store.release(requeue);
  const uniqueDead = [...new Set(deadTokens)];
  if (uniqueDead.length) await deps.store.deleteTokens(uniqueDead);
  return {
    claimed: claimed.length,
    sent: outcomes.filter((o) => o.error === null).length,
    skipped: skipped.length,
    failed: outcomes.filter((o) => o.error !== null).length,
    requeued: requeue.length,
    tokensRemoved: uniqueDead.length,
  };
}
