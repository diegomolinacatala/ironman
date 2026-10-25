/**
 * Expo push receipts, best effort. Most dead devices are only reported
 * asynchronously (receipt `DeviceNotRegistered`), not in the send ticket.
 * Ticket ids of successful sends are kept in memory (per isolate, bounded),
 * checked shortly after sending and on later invocations of the same isolate;
 * dead tokens are deleted and other receipt errors land in `push_error`.
 * Tickets whose receipt never shows up are dropped after `maxAgeMs`. The
 * push-dispatch sweep also prunes tokens not seen for STALE_TOKEN_DAYS
 * (backstop for isolates that died before checking).
 */
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { UUID } from '../types.ts';
import type { PushOutcome, PushStore } from './dispatch.ts';
import { chunk, EXPO_RECEIPTS_CHUNK_SIZE, fetchExpoReceipts } from './expo.ts';
import type { ExpoReceipt, FetchFn } from './expo.ts';

/** Receipts are usually ready within seconds; Expo keeps them for about a day. */
export const RECEIPT_MIN_AGE_MS = 5_000;
export const RECEIPT_MAX_AGE_MS = 30 * 60_000;
export const STALE_TOKEN_DAYS = 90;

export interface SentTicket {
  ticketId: string;
  token: string;
  notificationId: UUID;
}

export interface TrackedTicket extends SentTicket {
  sentAtMs: number;
}

export interface ReceiptTracker {
  track(tickets: readonly SentTicket[], nowMs: number): void;
  /** Removes and returns the tickets sent at least `minAgeMs` ago. */
  takeDue(nowMs: number, minAgeMs: number): TrackedTicket[];
  /** Puts tickets back (receipt not ready yet). */
  restore(tickets: readonly TrackedTicket[]): void;
  size(): number;
}

export function createReceiptTracker(maxSize = 10_000): ReceiptTracker {
  let pending: TrackedTicket[] = [];
  const cap = (list: TrackedTicket[]): TrackedTicket[] => (list.length > maxSize ? list.slice(list.length - maxSize) : list);
  return {
    track(tickets, nowMs) {
      pending = cap([...pending, ...tickets.map((t) => ({ ...t, sentAtMs: nowMs }))]);
    },
    takeDue(nowMs, minAgeMs) {
      const due = pending.filter((t) => nowMs - t.sentAtMs >= minAgeMs);
      pending = pending.filter((t) => nowMs - t.sentAtMs < minAgeMs);
      return due;
    },
    restore(tickets) {
      pending = cap([...tickets, ...pending]);
    },
    size: () => pending.length,
  };
}

export interface ReceiptDeps {
  store: Pick<PushStore, 'deleteTokens' | 'recordOutcomes'>;
  fetch: FetchFn;
  expoAccessToken?: string;
  now: () => Date;
  logger: Logger;
}

export interface ReceiptSummary {
  checked: number;
  tokensRemoved: number;
  errors: number;
  waiting: number;
}

interface Folded {
  deadTokens: string[];
  errors: PushOutcome[];
  notReady: TrackedTicket[];
}

/** Pure: what to do with each ticket given the receipts Expo returned. */
export function foldReceipts(tickets: readonly TrackedTicket[], receipts: ReadonlyMap<string, ExpoReceipt>, nowMs: number, maxAgeMs = RECEIPT_MAX_AGE_MS): Folded {
  const deadTokens: string[] = [];
  const failures = new Map<UUID, string>();
  const delivered = new Set<UUID>();
  const notReady: TrackedTicket[] = [];
  for (const t of tickets) {
    const receipt = receipts.get(t.ticketId);
    if (!receipt) {
      if (nowMs - t.sentAtMs < maxAgeMs) notReady.push(t);
      continue;
    }
    if (receipt.status === 'ok') {
      delivered.add(t.notificationId);
      continue;
    }
    if (receipt.details?.error === 'DeviceNotRegistered') deadTokens.push(t.token);
    else if (!failures.has(t.notificationId)) failures.set(t.notificationId, `Recibo de Expo: ${receipt.message}`.slice(0, 300));
  }
  // One delivered device is enough: only report notifications that failed everywhere.
  const errors = [...failures.entries()].filter(([id]) => !delivered.has(id)).map(([id, error]) => ({ id, error }));
  return { deadTokens: [...new Set(deadTokens)], errors, notReady };
}

/** Checks the receipts of every due ticket. Never throws (best effort). */
export async function checkReceipts(deps: ReceiptDeps, tracker: ReceiptTracker, minAgeMs = RECEIPT_MIN_AGE_MS): Promise<ReceiptSummary> {
  const nowMs = deps.now().getTime();
  const due = tracker.takeDue(nowMs, minAgeMs);
  const summary: ReceiptSummary = { checked: 0, tokensRemoved: 0, errors: 0, waiting: 0 };
  for (const part of chunk(due, EXPO_RECEIPTS_CHUNK_SIZE)) {
    try {
      const receipts = await fetchExpoReceipts(deps.fetch, part.map((t) => t.ticketId), deps.expoAccessToken);
      const folded = foldReceipts(part, receipts, nowMs);
      if (folded.deadTokens.length) await deps.store.deleteTokens(folded.deadTokens);
      if (folded.errors.length) await deps.store.recordOutcomes(folded.errors);
      tracker.restore(folded.notReady);
      summary.checked += part.length - folded.notReady.length;
      summary.tokensRemoved += folded.deadTokens.length;
      summary.errors += folded.errors.length;
    } catch (error) {
      deps.logger.warn('expo receipts failed', { size: part.length, ...errorInfo(error) });
      tracker.restore(part.filter((t) => nowMs - t.sentAtMs < RECEIPT_MAX_AGE_MS));
    }
  }
  summary.waiting = tracker.size();
  return summary;
}
