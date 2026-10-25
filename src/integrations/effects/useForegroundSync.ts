/**
 * Heavy device syncs (Apple Salud, calendar busy blocks) on mount and when the
 * app returns to the foreground, throttled to once every 10 minutes per account.
 * Each sync only runs when THIS account opted in on this device.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Repository } from '@/data/repository';
import { logger } from '@/lib/logger';

import { getSelectedCalendarIds, syncCalendarBusy } from '../calendar';
import { isHealthEnabled, syncHealth } from '../healthkit';

export const FOREGROUND_SYNC_THROTTLE_MS = 10 * 60_000;
const HEALTH_ROOTS = ['metrics', 'workouts', 'workout', 'feed', 'friend_week'];
const CALENDAR_ROOTS = ['busy_blocks', 'friend_week'];

type Invalidate = (roots: readonly string[]) => Promise<void>;

async function syncHealthIfEnabled(repo: Repository, userId: string, invalidate: Invalidate): Promise<void> {
  if (!(await isHealthEnabled(userId))) return;
  const result = await syncHealth(repo);
  logger.debug('health: foreground sync', result);
  await invalidate(HEALTH_ROOTS);
}

async function syncCalendarIfSelected(repo: Repository, userId: string, invalidate: Invalidate): Promise<void> {
  if ((await getSelectedCalendarIds(userId)).length === 0) return;
  const result = await syncCalendarBusy(repo);
  logger.debug('calendar: foreground sync', result);
  await invalidate(CALENDAR_ROOTS);
}

export async function runDeviceSyncs(repo: Repository, userId: string, invalidate: Invalidate): Promise<void> {
  const results = await Promise.allSettled([
    syncHealthIfEnabled(repo, userId, invalidate),
    syncCalendarIfSelected(repo, userId, invalidate),
  ]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') logger.warn(`foreground sync ${i === 0 ? 'health' : 'calendar'} failed`, r.reason);
  });
}

/**
 * @param enabled signed in, onboarded and on a native platform
 * @param userId the signed-in account (its own opt-ins decide what syncs)
 * @param onActive called every time the app becomes active (before throttling)
 */
export function useForegroundSync(enabled: boolean, repo: Repository, userId: string | null, onActive: () => void): void {
  const client = useQueryClient();
  const lastRun = useRef<{ userId: string | null; at: number }>({ userId: null, at: 0 });
  const onActiveRef = useRef(onActive);

  useEffect(() => {
    onActiveRef.current = onActive;
  }, [onActive]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const invalidate: Invalidate = async (roots) => {
      await Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: [root] })));
    };
    const run = () => {
      const now = Date.now();
      const last = lastRun.current;
      if (last.userId === userId && now - last.at < FOREGROUND_SYNC_THROTTLE_MS) return;
      lastRun.current = { userId, at: now };
      void runDeviceSyncs(repo, userId, invalidate);
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      onActiveRef.current();
      run();
    });
    return () => subscription.remove();
  }, [enabled, repo, userId, client]);
}
