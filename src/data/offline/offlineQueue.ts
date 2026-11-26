/**
 * The two things an athlete saves where there is no connection (pool, mountains):
 * the morning check-in and «Hecho» on a session. When the request cannot reach
 * the server, the change waits here, on the phone, until `offlineSync` sends it.
 *
 * Persisted in AsyncStorage per account (`rti.offline.queue.v1.user.<id>`) and
 * kept in memory for the signed-in account. One item per key: a newer check-in
 * of the same day, or a newer «Hecho» of the same session, replaces the older one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { CheckinDraft, CompletedData, ISODate, ISODateTime, UUID } from '@/domain/types';
import { logger } from '@/lib/logger';

export const OFFLINE_QUEUE_KEY = 'rti.offline.queue.v1';

interface ItemBase {
  /** Unique per enqueue (a replaced item gets a new id). */
  id: string;
  /** What it saves: `checkin:<date>` or `complete:<workoutId>`. */
  key: string;
  queuedAt: ISODateTime;
}

export type OfflineItem =
  | (ItemBase & { kind: 'checkin'; draft: CheckinDraft })
  | (ItemBase & { kind: 'complete'; workoutId: UUID; data: CompletedData });

/** An item before it gets its id and time. */
export type OfflineItemDraft =
  | { kind: 'checkin'; key: string; draft: CheckinDraft }
  | { kind: 'complete'; key: string; workoutId: UUID; data: CompletedData };

interface QueueState {
  userId: UUID | null;
  items: readonly OfflineItem[];
}

const EMPTY: readonly OfflineItem[] = [];

let state: QueueState = { userId: null, items: EMPTY };
let loaded: { userId: UUID; promise: Promise<void> } | null = null;
let writes: Promise<void> = Promise.resolve();
let seq = 0;
const listeners = new Set<() => void>();

export function checkinKey(date: ISODate): string {
  return `checkin:${date}`;
}

export function completeKey(workoutId: UUID): string {
  return `complete:${workoutId}`;
}

export function storageKeyFor(userId: UUID): string {
  return `${OFFLINE_QUEUE_KEY}.user.${userId}`;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeOfflineQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isItem(value: unknown): value is OfflineItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.key !== 'string' || typeof v.queuedAt !== 'string') return false;
  if (v.kind === 'checkin') return Boolean(v.draft) && typeof v.draft === 'object';
  return v.kind === 'complete' && typeof v.workoutId === 'string' && Boolean(v.data) && typeof v.data === 'object';
}

/** Parses what was stored; anything malformed is dropped. */
export function parseOfflineItems(raw: string | null): OfflineItem[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isItem) : [];
  } catch {
    return [];
  }
}

function setItems(userId: UUID, items: readonly OfflineItem[]): void {
  state = { userId, items: items.length > 0 ? items : EMPTY };
  emit();
  const snapshot = JSON.stringify(items);
  // Writes run one after another so an older snapshot never lands last.
  writes = writes
    .then(() => (items.length > 0 ? AsyncStorage.setItem(storageKeyFor(userId), snapshot) : AsyncStorage.removeItem(storageKeyFor(userId))))
    .catch((error: unknown) => logger.warn('offline: could not save the queue', error));
}

/** Loads `userId`'s queue into memory (once per account; switching accounts reloads). */
export function loadOfflineQueue(userId: UUID): Promise<void> {
  if (loaded?.userId === userId) return loaded.promise;
  if (state.userId !== userId) {
    state = { userId, items: EMPTY };
    emit();
  }
  const promise = AsyncStorage.getItem(storageKeyFor(userId))
    .then((raw) => {
      if (state.userId !== userId) return;
      // Items queued while the read was running win over stored ones with the same key.
      const keys = new Set(state.items.map((item) => item.key));
      const stored = parseOfflineItems(raw).filter((item) => !keys.has(item.key));
      if (stored.length > 0) setItems(userId, [...stored, ...state.items]);
    })
    .catch((error: unknown) => logger.warn('offline: could not read the queue', error));
  loaded = { userId, promise };
  return promise;
}

/** Items waiting for `userId` (none when another account is loaded). */
export function getOfflineItems(userId: UUID | null | undefined): readonly OfflineItem[] {
  return userId && state.userId === userId ? state.items : EMPTY;
}

/** Keeps a change on the phone, replacing an older one with the same key. */
export async function enqueueOffline(userId: UUID, draft: OfflineItemDraft, now: Date = new Date()): Promise<OfflineItem> {
  await loadOfflineQueue(userId);
  seq += 1;
  const item = { ...draft, id: `${now.getTime().toString(36)}-${seq}`, queuedAt: now.toISOString() } as OfflineItem;
  setItems(userId, [...getOfflineItems(userId).filter((other) => other.key !== draft.key), item]);
  return item;
}

/** Drops one queued item (sent, refused or superseded). */
export function removeOfflineItem(userId: UUID, id: string): void {
  const items = getOfflineItems(userId);
  if (items.some((item) => item.id === id)) setItems(userId, items.filter((item) => item.id !== id));
}

/** Drops whatever is queued under `key` (a newer save went through, or «Reabrir» undid a «Hecho»). */
export async function removeOfflineKey(userId: UUID, key: string): Promise<void> {
  await loadOfflineQueue(userId);
  const items = getOfflineItems(userId);
  if (items.some((item) => item.key === key)) setItems(userId, items.filter((item) => item.key !== key));
}

/** Waits for pending storage writes (tests, sign-out). */
export function offlineWritesSettled(): Promise<void> {
  return writes;
}

/**
 * Forgets what waited for `userId` (the account was deleted: nothing left to send it to).
 * A plain sign-out keeps it: signing in again with the same account sends it.
 */
export async function clearOfflineQueue(userId: UUID): Promise<void> {
  if (state.userId === userId && state.items.length > 0) {
    state = { userId, items: EMPTY };
    emit();
  }
  await writes;
  try {
    await AsyncStorage.removeItem(storageKeyFor(userId));
  } catch (error) {
    logger.warn('offline: could not clear the queue', error);
  }
}

/** Items waiting for the signed-in `userId`, re-rendering when they change. */
export function useOfflineItems(userId: UUID | null | undefined): readonly OfflineItem[] {
  return useSyncExternalStore(
    subscribeOfflineQueue,
    () => getOfflineItems(userId),
    () => EMPTY,
  );
}

/**
 * Items waiting for the account whose queue is loaded — the signed-in one, which
 * `useOfflineSync` loads on sign-in. For notices that live outside the data context.
 */
export function usePendingOffline(): readonly OfflineItem[] {
  return useSyncExternalStore(
    subscribeOfflineQueue,
    () => state.items,
    () => EMPTY,
  );
}

/** Test helper: forget everything in memory (storage is the jest mock). */
export function resetOfflineQueueForTests(): void {
  state = { userId: null, items: EMPTY };
  loaded = null;
  writes = Promise.resolve();
  emit();
}
