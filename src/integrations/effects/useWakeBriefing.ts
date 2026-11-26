/**
 * Wake-up briefing, Apple Salud path (best effort). While the athlete is in wake mode and
 * Apple Salud is on for this account on this iPhone (and there is a backend to coordinate
 * with), sleep writes are watched — also in the background through HealthKit background
 * delivery — and checked again whenever the app becomes active. Each check runs
 * `handleSleepUpdate` (claim today's briefing, then a local notification at wake-up + delay)
 * and uploads the night, so the server learns the usual wake-up window. When wake mode or
 * Apple Salud is known to be off, the background delivery is turned off again.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Repository } from '@/data/repository';
import type { NotificationPrefs } from '@/domain/types';
import { logger } from '@/lib/logger';

import { readUserJson, writeUserJson } from '../deviceState';
import { isHealthEnabled, readLastNight, requestHealthPermissions, syncHealth } from '../healthkit';
import { stopSleepWatch, watchSleep } from '../health/sleepWatch';
import { handleSleepUpdate, type WakeBriefingDeps } from '../health/wakeBriefing';
import { getNotificationPermission, scheduleWakeBriefing } from '../notifications';

/** True / false once known, null while the profile is loading. */
export function wantsWakeWatch(prefs: NotificationPrefs | null, hasServer: boolean): boolean | null {
  if (!prefs) return null;
  return hasServer && prefs.morningSummary && prefs.morningMode === 'wake';
}

function depsFor(repo: Repository, userId: string): WakeBriefingDeps {
  return {
    readLastNight: () => readLastNight(repo),
    canNotify: async () => (await getNotificationPermission()) === 'granted',
    claim: (input) => (repo.claimWakeBriefing ? repo.claimWakeBriefing(input) : Promise.resolve(false)),
    schedule: scheduleWakeBriefing,
    handledDay: async () => {
      const value = await readUserJson<unknown>('wakeBriefingDay', userId, null);
      return typeof value === 'string' ? value : null;
    },
    setHandledDay: (date) => writeUserJson('wakeBriefingDay', userId, date),
    now: () => new Date(),
  };
}

/**
 * @param enabled signed in, onboarded and on a native platform
 */
export function useWakeBriefing(enabled: boolean, repo: Repository, userId: string | null, prefs: NotificationPrefs | null): void {
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const running = useRef(false);
  const wanted = enabled ? wantsWakeWatch(prefs, typeof repo.claimWakeBriefing === 'function') : null;

  useEffect(() => {
    if (wanted === null || !userId) return undefined;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    const check = async () => {
      const current = prefsRef.current;
      if (running.current || !current) return;
      running.current = true;
      try {
        const outcome = await handleSleepUpdate(current, depsFor(repo, userId));
        logger.debug('wake briefing: sleep update', { outcome });
        if (outcome === 'scheduled' || outcome === 'taken') await syncHealth(repo, { days: 2 });
      } catch (error) {
        logger.warn('wake briefing: sleep update failed', error);
      } finally {
        running.current = false;
      }
    };
    void (async () => {
      const healthOn = await isHealthEnabled(userId);
      if (cancelled) return;
      if (!wanted || !healthOn) {
        await stopSleepWatch();
        return;
      }
      // HealthKit rule: authorization before any query, observers included (no sheet for types already asked).
      if (!(await requestHealthPermissions()) || cancelled) return;
      unsubscribe = watchSleep(() => void check());
      void check();
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && wanted) void check();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      subscription.remove();
    };
  }, [wanted, userId, repo]);
}
