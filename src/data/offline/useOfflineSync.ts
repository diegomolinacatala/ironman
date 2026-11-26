/**
 * Sends what waits on the phone (`offlineQueue`) as soon as there is a chance:
 * when the account signs in, when the app comes back to the foreground, when
 * TanStack Query's `onlineManager` reports the connection is back (browser events
 * on web; React Native has no network listener installed, so there the foreground
 * and the timer do the work) and on a retry timer with backoff while anything
 * waits. A sent change updates the cached screens at once, then they refetch.
 */
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { DailyCheckin, UUID, Workout } from '@/domain/types';
import { logger } from '@/lib/logger';

import { useRepository } from '../context';
import { getOfflineItems, loadOfflineQueue, subscribeOfflineQueue } from './offlineQueue';
import { flushOfflineQueue, type FlushRepo, type SentValue } from './offlineSync';

/** Retry delays while something waits; the last one repeats until the app returns or the connection does. */
export const RETRY_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000, 120_000, 300_000];

const flushRequests = new Set<() => void>();

/** «Reintentar» on the notice: try to send now. */
export function requestOfflineFlush(): void {
  flushRequests.forEach((listener) => listener());
}

/** Listens to «Reintentar» (the bridge does). */
export function listenFlushRequests(listener: () => void): () => void {
  flushRequests.add(listener);
  return () => {
    flushRequests.delete(listener);
  };
}

const byDate = (a: DailyCheckin, b: DailyCheckin): number => a.date.localeCompare(b.date);

/** Puts what the server returned into the cached lists, so nothing flickers between the overlay and the refetch. */
export function applySentToCache(client: QueryClient, value: SentValue): void {
  if (value.kind === 'checkin') {
    const checkin = value.checkin;
    for (const [key, data] of client.getQueriesData<DailyCheckin[]>({ queryKey: ['checkins'] })) {
      const [, from, to] = key as readonly unknown[];
      if (!data || typeof from !== 'string' || typeof to !== 'string' || checkin.date < from || checkin.date > to) continue;
      client.setQueryData<DailyCheckin[]>(key, [...data.filter((c) => c.date !== checkin.date), checkin].sort(byDate));
    }
    return;
  }
  const workout = value.workout;
  if (!workout) return;
  client.setQueriesData<Workout[]>({ queryKey: ['workouts'] }, (old) => old?.map((w) => (w.id === workout.id ? workout : w)));
  client.setQueryData<Workout | null>(['workout', workout.id], (old) => (old ? workout : old));
}

const ROOTS: Record<SentValue['kind'], readonly string[]> = {
  checkin: ['checkins'],
  complete: ['workouts', 'workout', 'feed', 'friend_week'],
};

interface SyncDeps {
  repo: FlushRepo;
  client: QueryClient;
  userId: UUID;
}

/** Sends the queue once; the screens get each sent change at once, then refetch. True when nothing waits any more. */
async function sendQueue({ repo, client, userId }: SyncDeps): Promise<boolean> {
  const roots = new Set<string>();
  try {
    const result = await flushOfflineQueue({
      repo,
      userId,
      onSent: (_item, value) => {
        applySentToCache(client, value);
        ROOTS[value.kind].forEach((root) => roots.add(root));
      },
    });
    return result.remaining === 0;
  } catch (error) {
    logger.warn('offline: sending the queue failed', error);
    return false;
  } finally {
    roots.forEach((root) => void client.invalidateQueries({ queryKey: [root] }));
  }
}

/** Starts sending `userId`'s queue whenever there is a chance; returns the stop function. */
export function startOfflineSync(deps: SyncDeps, delays: readonly number[] = RETRY_DELAYS_MS): () => void {
  const { userId } = deps;
  let disposed = false;
  let running = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const waiting = () => getOfflineItems(userId).length > 0;
  const schedule = () => {
    if (disposed || running || timer || !waiting()) return;
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };
  const run = async () => {
    if (disposed || running || !waiting()) return;
    if (timer) clearTimeout(timer);
    timer = null;
    running = true;
    const done = await sendQueue(deps);
    running = false;
    if (done) attempt = 0;
    schedule();
  };
  const now = () => {
    attempt = 0;
    void run();
  };

  void loadOfflineQueue(userId).then(run);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') now();
  });
  const stops = [
    () => appState.remove(),
    onlineManager.subscribe((online) => {
      if (online) now();
    }),
    // Something new waits (a save without connection): make sure a retry is on its way.
    subscribeOfflineQueue(schedule),
    listenFlushRequests(now),
  ];
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    stops.forEach((stop) => stop());
  };
}

/** Keeps `userId`'s queue moving while they are signed in. */
export function useOfflineSync(userId: UUID | null, retryDelaysMs: readonly number[] = RETRY_DELAYS_MS): void {
  const repo = useRepository();
  const client = useQueryClient();
  const delays = retryDelaysMs.length > 0 ? retryDelaysMs : RETRY_DELAYS_MS;
  useEffect(() => (userId ? startOfflineSync({ repo, client, userId }, delays) : undefined), [repo, client, userId, delays]);
}

/** Mounted once while signed in (`RepositoryProvider`). */
export function OfflineSyncBridge({ userId, retryDelaysMs }: { userId: UUID; retryDelaysMs?: readonly number[] }): null {
  useOfflineSync(userId, retryDelaysMs);
  return null;
}
