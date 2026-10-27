/**
 * Keeps Garmin fresh without the user asking: on mount and whenever the app comes back to
 * the foreground, if Garmin is connected and its last sync is older than an hour, runs
 * `repo.syncGarmin()` in the background and refreshes metrics / workouts.
 *
 * Never blocks the UI (fire and forget), never throws (logged), one run at a time, and
 * at most one attempt every 15 minutes per account (a failing sync does not move
 * `lastSyncAt`). Server-only work, so it is web-safe and also runs in the web preview.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Repository } from '@/data/repository';
import type { IntegrationStatus } from '@/domain/types';
import { logger } from '@/lib/logger';

export const GARMIN_STALE_MS = 60 * 60_000;
export const GARMIN_RETRY_MS = 15 * 60_000;
const GARMIN_ROOTS = ['integrations', 'metrics', 'workouts', 'workout', 'feed'] as const;

type Invalidate = (roots: readonly string[]) => Promise<void>;

/** Connected Garmin whose last sync is missing, unreadable or older than an hour. */
export function isGarminSyncDue(integrations: readonly IntegrationStatus[], now: number): boolean {
  const garmin = integrations.find((i) => i.provider === 'garmin_personal');
  if (!garmin || garmin.state !== 'connected') return false;
  if (!garmin.lastSyncAt) return true;
  const last = Date.parse(garmin.lastSyncAt);
  return !Number.isFinite(last) || now - last >= GARMIN_STALE_MS;
}

/** Syncs when due. Resolves true when a sync ran. */
export async function syncGarminIfStale(
  repo: Pick<Repository, 'listIntegrations' | 'syncGarmin'>,
  invalidate: Invalidate,
  now: number = Date.now(),
): Promise<boolean> {
  if (!isGarminSyncDue(await repo.listIntegrations(), now)) return false;
  const result = await repo.syncGarmin();
  logger.debug('garmin: foreground sync', result);
  await invalidate(GARMIN_ROOTS);
  return true;
}

/**
 * @param enabled signed in and onboarded
 * @param userId the signed-in account (throttling is per account)
 */
export function useGarminForegroundSync(enabled: boolean, repo: Repository, userId: string | null): void {
  const client = useQueryClient();
  const lastAttempt = useRef<{ userId: string | null; at: number }>({ userId: null, at: 0 });
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const invalidate: Invalidate = async (roots) => {
      await Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: [root] })));
    };
    const run = () => {
      const now = Date.now();
      const last = lastAttempt.current;
      if (running.current || (last.userId === userId && now - last.at < GARMIN_RETRY_MS)) return;
      lastAttempt.current = { userId, at: now };
      running.current = true;
      syncGarminIfStale(repo, invalidate, now)
        .catch((error: unknown) => logger.warn('garmin: foreground sync failed', error))
        .finally(() => {
          running.current = false;
        });
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [enabled, repo, userId, client]);
}
