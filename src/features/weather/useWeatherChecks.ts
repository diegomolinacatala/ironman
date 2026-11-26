/**
 * Runs the weather checks (weekly on Monday / Sunday evening, daily on the
 * first open of the day) when the app opens or comes back to the foreground,
 * for athletes with a city. Mounted once by AppEffects; one run at a time per
 * account. A new proposal shows up in Hoy like any other (banner → review).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useRepository } from '@/data/context';
import type { Profile } from '@/domain/types';
import { logger } from '@/lib/logger';

import { runWeatherCheck } from './runWeatherCheck';

const running = new Set<string>();

export function useWeatherChecks(enabled: boolean, userId: string | null, profile: Profile | null, tick: number): void {
  const repo = useRepository();
  const client = useQueryClient();
  const place = profile?.weatherPlace ?? null;

  useEffect(() => {
    if (!enabled || !userId || !profile || !place || !repo.getWeather || running.has(userId)) return;
    running.add(userId);
    runWeatherCheck(repo, userId, profile)
      .then((outcome) => {
        if (outcome === 'proposed' || outcome === 'blocked' || outcome === 'nothing') void client.invalidateQueries({ queryKey: ['proposals'] });
      })
      .catch((error: unknown) => logger.warn('weather check failed', error))
      .finally(() => running.delete(userId));
    // `tick` changes every time the app comes back to the foreground.
  }, [enabled, userId, profile, place, repo, client, tick]);
}
