/**
 * Sending the check-in and «Hecho» even without connection:
 * - `saveOrQueue` tries the server; when there is no connection (or it takes too
 *   long) the change stays on the phone (`offlineQueue`) and the caller gets the
 *   optimistic result, so the screen moves on as if it had been saved.
 * - `flushOfflineQueue` sends what is waiting, oldest first, one at a time. Both
 *   writes are idempotent: the check-in is an upsert by date, and a «Hecho» is
 *   compared with the session on the server first (deleted → dropped; already
 *   completed with this or a newer «Hecho» → nothing to send; completed by the
 *   watch → its numbers stay and only RPE, sensations and notes are added).
 * Retries are driven by `useOfflineSync` (foreground, onlineManager, a timer).
 */
import type { CheckinDraft, CompletedData, DailyCheckin, UUID, Workout } from '@/domain/types';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import {
  enqueueOffline,
  getOfflineItems,
  loadOfflineQueue,
  removeOfflineItem,
  removeOfflineKey,
  type OfflineItem,
  type OfflineItemDraft,
} from './offlineQueue';

/** How long a save may take before it is kept on the phone instead (weak signal can hang a request for a minute). */
export const SAVE_TIMEOUT_MS = 10_000;
/** How long one queued item may take while flushing before we try again later. */
export const FLUSH_ITEM_TIMEOUT_MS = 20_000;

export class SaveTimeoutError extends Error {
  constructor() {
    super('La conexión va muy lenta. Inténtalo de nuevo.');
    this.name = 'SaveTimeoutError';
  }
}

/** Codes that mean "try again later" (no connection, server busy, session not refreshed yet), not "this is wrong". */
const RETRYABLE: ReadonlySet<string> = new Set(['network', 'unavailable', 'rate_limited', 'not_authenticated']);

export function isRetryableError(error: unknown): boolean {
  if (error instanceof SaveTimeoutError) return true;
  return error instanceof RepositoryError && RETRYABLE.has(error.code);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SaveTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface SaveOrQueueInput<T> {
  /** The signed-in account (nothing is queued without one). */
  userId: UUID | null;
  item: OfflineItemDraft;
  send: () => Promise<T>;
  /** What the screen shows while the change waits on the phone; null when it cannot be built. */
  optimistic: () => T | null;
  /** onlineManager's view: when it already knows there is no connection, the request is not even tried. */
  isOnline?: () => boolean;
  timeoutMs?: number;
}

export interface SaveOutcome<T> {
  result: T;
  /** True when the change is waiting on the phone. */
  queued: boolean;
}

/** Saves now, or keeps the change on the phone when there is no connection. Other errors are thrown as usual. */
export async function saveOrQueue<T>({ userId, item, send, optimistic, isOnline, timeoutMs = SAVE_TIMEOUT_MS }: SaveOrQueueInput<T>): Promise<SaveOutcome<T>> {
  if (!userId) return { result: await send(), queued: false };
  if (isOnline && !isOnline()) {
    const result = optimistic();
    if (result !== null) {
      await enqueueOffline(userId, item);
      return { result, queued: true };
    }
  }
  const attempt = send();
  try {
    const result = await withTimeout(attempt, timeoutMs);
    // This save is newer than anything still waiting for the same day or session.
    await removeOfflineKey(userId, item.key);
    return { result, queued: false };
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    const result = optimistic();
    if (result === null) throw error;
    const queued = await enqueueOffline(userId, item);
    if (error instanceof SaveTimeoutError) {
      // The slow request may still land: then the copy on the phone is not needed.
      attempt.then(
        () => removeOfflineItem(userId, queued.id),
        () => undefined,
      );
    }
    logger.debug(`offline: ${item.kind} kept on the phone`);
    return { result, queued: true };
  }
}

/** The session as the athlete marked it done (the optimistic «Hecho»). */
export function completedWorkout(workout: Workout, data: CompletedData): Workout {
  return { ...workout, status: 'completed', completed: { source: 'manual', ...data } };
}

/** The check-in as it will be stored. */
export function checkinOf(userId: UUID, draft: CheckinDraft): DailyCheckin {
  return { ...draft, userId };
}

function subjectiveOf(queued: CompletedData): Partial<CompletedData> {
  return {
    ...(queued.rpe !== undefined ? { rpe: queued.rpe } : {}),
    ...(queued.feel !== undefined ? { feel: queued.feel } : {}),
    ...(queued.notes ? { notes: queued.notes } : {}),
  };
}

/**
 * What to send for a queued «Hecho», given the session on the server now; null when
 * there is nothing to send (deleted, or this / a newer «Hecho» already landed).
 */
export function completionToSend(current: Workout | null, queued: CompletedData): CompletedData | null {
  if (!current) return null;
  const done = current.status === 'completed' ? current.completed : null;
  if (!done) return queued;
  const source = done.source ?? 'manual';
  if (source === 'manual') {
    const landed = Boolean(done.completedAt && queued.completedAt && done.completedAt >= queued.completedAt);
    return landed ? null : queued;
  }
  // The watch (or Apple Salud, or Claude) got there first: keep its numbers, add how it felt.
  const subjective = subjectiveOf(queued);
  const changes = Object.entries(subjective).some(([key, value]) => done[key as keyof CompletedData] !== value);
  return changes ? { ...done, ...subjective } : null;
}

export type FlushRepo = Pick<Repository, 'upsertCheckin' | 'getWorkout' | 'completeWorkout'>;

/** What a sent item became on the server (to update the screens without waiting for a refetch). */
export type SentValue = { kind: 'checkin'; checkin: DailyCheckin } | { kind: 'complete'; workout: Workout | null };

export interface FlushDeps {
  repo: FlushRepo;
  userId: UUID;
  /** Called after each item reached the server (or turned out to be there already), before it leaves the queue. */
  onSent?: (item: OfflineItem, value: SentValue) => void | Promise<void>;
  itemTimeoutMs?: number;
}

export interface FlushResult {
  sent: number;
  /** Items the server refused for good (e.g. the session was deleted): dropped. */
  dropped: number;
  /** Items still waiting (no connection yet). */
  remaining: number;
}

async function sendItem(repo: FlushRepo, item: OfflineItem): Promise<SentValue> {
  if (item.kind === 'checkin') return { kind: 'checkin', checkin: await repo.upsertCheckin(item.draft) };
  const current = await repo.getWorkout(item.workoutId);
  const data = completionToSend(current, item.data);
  if (!data) return { kind: 'complete', workout: current };
  return { kind: 'complete', workout: await repo.completeWorkout(item.workoutId, data) };
}

let inFlight: Promise<FlushResult> | null = null;

async function runFlush({ repo, userId, onSent, itemTimeoutMs = FLUSH_ITEM_TIMEOUT_MS }: FlushDeps): Promise<FlushResult> {
  await loadOfflineQueue(userId);
  let sent = 0;
  let dropped = 0;
  for (const item of getOfflineItems(userId)) {
    try {
      const value = await withTimeout(sendItem(repo, item), itemTimeoutMs);
      await onSent?.(item, value);
      sent += 1;
    } catch (error) {
      // Still no connection: keep this and everything after it, in order.
      if (isRetryableError(error)) return { sent, dropped, remaining: getOfflineItems(userId).length };
      logger.warn(`offline: the server refused a queued ${item.kind}, dropping it`, error instanceof RepositoryError ? error.code : error);
      dropped += 1;
    }
    removeOfflineItem(userId, item.id);
  }
  return { sent, dropped, remaining: getOfflineItems(userId).length };
}

/** Sends everything waiting for `userId`, oldest first (one flush at a time). */
export function flushOfflineQueue(deps: FlushDeps): Promise<FlushResult> {
  inFlight ??= runFlush(deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
