/**
 * Push dispatch: claims unsent notifications (last 24 h) and sends one APNs
 * request per registered iOS device of the owner (bounded concurrency),
 * respecting `notification_prefs.social` for social types. Claiming first
 * (pushed_at = now where null) prevents double sends when the trigger call
 * and the cron sweep overlap. Per notification:
 * - delivered to any device → push_error null;
 * - a 403 on any device → push_error (not retried);
 * - else 429 / 5xx / network on some device → back in the queue (pushed_at null) for the next sweep;
 * - otherwise → push_error with the APNs status and reason.
 * Tokens answered with 410 or 400 BadDeviceToken/DeviceTokenNotForTopic/Unregistered are deleted.
 * A 403 (provider token rejected) makes the sender drop its cached JWT and stops this run: the
 * notifications not attempted yet go back to the queue. Without APNS_* secrets nothing is sent and
 * the notifications get push_error 'apns_not_configured'.
 */
import type { Logger } from '../log.ts';
import type { UUID } from '../types.ts';
import { apnsErrorText, isApnsDeviceToken } from './apns.ts';
import type { ApnsFailure, ApnsMessage, ApnsResult, ApnsSender } from './apns.ts';

/** Types silenced by `notification_prefs.social = false`. Invites, cancellations and plan proposals always go out. */
export const SOCIAL_TYPES: ReadonlySet<string> = new Set(['friend_request', 'friend_accepted', 'friend_completed', 'kudos']);
export const PUSH_WINDOW_MS = 24 * 3600_000;
export const APNS_CONCURRENCY = 8;
export const NOT_CONFIGURED_ERROR = 'apns_not_configured';
const RETRY_SUFFIX = ' (se reintentará)';

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

export interface DeviceToken {
  token: string;
  userId: UUID;
}

export interface PushStore {
  listUnsent(sinceIso: string, limit: number): Promise<PendingNotification[]>;
  /** Atomically sets pushed_at where still null; returns the ids this call owns. */
  claim(ids: UUID[]): Promise<UUID[]>;
  /** Puts notifications back in the queue after a transient failure. */
  release(ids: UUID[]): Promise<void>;
  /** iOS (APNs) device tokens of these users. */
  listTokens(userIds: UUID[]): Promise<DeviceToken[]>;
  /** user id → notification_prefs.social (missing users default to true). */
  socialPrefs(userIds: UUID[]): Promise<Map<UUID, boolean>>;
  recordOutcomes(outcomes: PushOutcome[]): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
  /** Deletes tokens whose last_seen_at is older than `beforeIso`; returns how many. */
  pruneStaleTokens(beforeIso: string): Promise<number>;
}

export type PushSender = Pick<ApnsSender, 'send'>;

export interface DispatchDeps {
  store: PushStore;
  /** APNs sender; null when the APNS_* secrets are missing. */
  sender: PushSender | null;
  now: () => Date;
  logger: Logger;
  /** Requests in flight at once (default APNS_CONCURRENCY). */
  concurrency?: number;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  requeued: number;
  tokensRemoved: number;
}

export interface Envelope {
  notificationId: UUID;
  message: ApnsMessage;
}

export interface Delivery {
  envelope: Envelope;
  result: ApnsResult;
}

export function toApnsMessage(n: PendingNotification, deviceToken: string): ApnsMessage {
  return {
    deviceToken,
    title: n.title,
    body: n.body,
    threadId: n.type,
    collapseId: n.id,
    data: { ...n.data, notificationId: n.id, type: n.type },
  };
}

function plan(
  pending: readonly PendingNotification[],
  tokens: readonly DeviceToken[],
  prefs: ReadonlyMap<UUID, boolean>,
): { envelopes: Envelope[]; skipped: PushOutcome[] } {
  const envelopes: Envelope[] = [];
  const skipped: PushOutcome[] = [];
  for (const n of pending) {
    if (SOCIAL_TYPES.has(n.type) && prefs.get(n.userId) === false) {
      skipped.push({ id: n.id, error: 'omitida: avisos sociales desactivados' });
      continue;
    }
    const mine = tokens.filter((t) => t.userId === n.userId && isApnsDeviceToken(t.token));
    if (mine.length === 0) {
      skipped.push({ id: n.id, error: 'omitida: sin dispositivos registrados' });
      continue;
    }
    mine.forEach((t) => envelopes.push({ notificationId: n.id, message: toApnsMessage(n, t.token) }));
  }
  return { envelopes, skipped };
}

/** Maps `items` with at most `limit` calls of `fn` in flight; results keep the input order. */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Sends every envelope; after the first provider-token failure the rest are not attempted (they are retried later). */
export async function sendAll(sender: PushSender, envelopes: readonly Envelope[], concurrency = APNS_CONCURRENCY): Promise<Delivery[]> {
  let authFailed = false;
  return mapBounded(envelopes, concurrency, async (envelope): Promise<Delivery> => {
    if (authFailed) return { envelope, result: { kind: 'retry', status: 0, reason: 'NotSentAfterAuthError' } };
    const result = await sender.send(envelope.message);
    if (result.kind === 'auth') authFailed = true;
    return { envelope, result };
  });
}

export interface FoldedDeliveries {
  outcomes: PushOutcome[];
  requeue: UUID[];
  deadTokens: string[];
}

const FAILURE_PRIORITY: Record<ApnsFailure['kind'], number> = { auth: 0, rejected: 1, unregistered: 2, retry: 3 };

/** Pure: one outcome per notification from its per-device results. */
export function foldDeliveries(deliveries: readonly Delivery[]): FoldedDeliveries {
  const byNotification = new Map<UUID, ApnsResult[]>();
  deliveries.forEach((d) => byNotification.set(d.envelope.notificationId, [...(byNotification.get(d.envelope.notificationId) ?? []), d.result]));
  const outcomes: PushOutcome[] = [];
  const requeue: UUID[] = [];
  for (const [id, results] of byNotification) {
    const failures = results.filter((r): r is ApnsFailure => r.kind !== 'sent');
    if (failures.length < results.length) {
      outcomes.push({ id, error: null });
      continue;
    }
    // A provider-token failure would hit the other devices too: it is recorded, not retried.
    const retry = failures.some((f) => f.kind === 'auth') ? undefined : failures.find((f) => f.kind === 'retry');
    if (retry) {
      requeue.push(id);
      outcomes.push({ id, error: `${apnsErrorText(retry)}${RETRY_SUFFIX}` });
      continue;
    }
    const worst = [...failures].sort((a, b) => FAILURE_PRIORITY[a.kind] - FAILURE_PRIORITY[b.kind])[0];
    outcomes.push({ id, error: apnsErrorText(worst) });
  }
  const deadTokens = deliveries.filter((d) => d.result.kind === 'unregistered').map((d) => d.envelope.message.deviceToken);
  return { outcomes, requeue, deadTokens: [...new Set(deadTokens)] };
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export async function dispatchPending(deps: DispatchDeps, opts: { limit?: number } = {}): Promise<DispatchSummary> {
  const since = new Date(deps.now().getTime() - PUSH_WINDOW_MS).toISOString();
  const pending = await deps.store.listUnsent(since, opts.limit ?? 300);
  const claimedIds = new Set(pending.length ? await deps.store.claim(pending.map((n) => n.id)) : []);
  const claimed = pending.filter((n) => claimedIds.has(n.id));
  if (claimed.length === 0) return { claimed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0, tokensRemoved: 0 };
  const userIds = unique(claimed.map((n) => n.userId));
  const [tokens, prefs] = await Promise.all([deps.store.listTokens(userIds), deps.store.socialPrefs(userIds)]);
  const { envelopes, skipped } = plan(claimed, tokens, prefs);

  if (!deps.sender) {
    const ids = unique(envelopes.map((e) => e.notificationId));
    await deps.store.recordOutcomes([...skipped, ...ids.map((id) => ({ id, error: NOT_CONFIGURED_ERROR }))]);
    return { claimed: claimed.length, sent: 0, skipped: skipped.length, failed: ids.length, requeued: 0, tokensRemoved: 0 };
  }

  const deliveries = await sendAll(deps.sender, envelopes, deps.concurrency);
  const authFailure = deliveries.map((d) => d.result).find((r): r is ApnsFailure => r.kind === 'auth');
  if (authFailure) deps.logger.error('apns rejected the provider token', { status: authFailure.status, reason: authFailure.reason });
  const { outcomes, requeue, deadTokens } = foldDeliveries(deliveries);
  await deps.store.recordOutcomes([...skipped, ...outcomes]);
  if (requeue.length) await deps.store.release(requeue);
  if (deadTokens.length) await deps.store.deleteTokens(deadTokens);
  const failed = outcomes.filter((o) => o.error !== null).length - requeue.length;
  return {
    claimed: claimed.length,
    sent: outcomes.filter((o) => o.error === null).length,
    skipped: skipped.length,
    failed,
    requeued: requeue.length,
    tokensRemoved: deadTokens.length,
  };
}
