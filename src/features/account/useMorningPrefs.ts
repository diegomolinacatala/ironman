import { useCallback, useEffect, useRef, useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { ISOTime, NotificationPrefs, Profile } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { DEFAULT_MORNING_TIME } from '../onboarding/onboardingModel';

/** The iOS compact time picker reports every wheel step: wait for the athlete to settle. */
export const MORNING_TIME_DEBOUNCE_MS = 600;

export type MorningPrefs = Pick<NotificationPrefs, 'morningSummary' | 'morningTime'>;

function morningOf(profile: Profile): MorningPrefs {
  return {
    morningSummary: profile.notificationPrefs.morningSummary,
    morningTime: profile.notificationPrefs.morningTime || DEFAULT_MORNING_TIME,
  };
}

export interface MorningPrefsState {
  prefs: MorningPrefs;
  error: string | null;
  setEnabled: (on: boolean) => Promise<void>;
  setTime: (time: ISOTime) => void;
}

/**
 * Morning report on/off + time with optimistic UI. Time changes are debounced,
 * saves run one after another, and each save sends this section's latest
 * wishes over the latest profile prefs, so a quick toggle + time change can
 * never revert each other (or other notification settings).
 */
export function useMorningPrefs(profile: Profile): MorningPrefsState {
  const update = useUpdateProfile();
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [prefs, setPrefs] = useState<MorningPrefs>(() => morningOf(profile));
  const wanted = useRef<MorningPrefs>(prefs);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { morningSummary, morningTime } = profile.notificationPrefs;

  // Follow changes made elsewhere (Avisos screen, another device) while nothing is pending here.
  useEffect(() => {
    if (inFlight.current > 0 || timer.current) return;
    const next = morningOf(profileRef.current);
    wanted.current = next;
    setPrefs(next);
  }, [morningSummary, morningTime]);

  const save = useCallback((): Promise<void> => {
    inFlight.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        await update.mutateAsync({ notificationPrefs: { ...profileRef.current.notificationPrefs, ...wanted.current } });
        haptics.success();
      } catch (err) {
        logger.warn('tú: morning report save failed', err);
        setError(errorMessage(err, 'No se pudo guardar. Inténtalo de nuevo.'));
        const saved = morningOf(profileRef.current);
        wanted.current = saved;
        setPrefs(saved);
      } finally {
        inFlight.current -= 1;
      }
    });
    return queue.current;
  }, [update]);

  const change = useCallback(
    (patch: Partial<MorningPrefs>, debounce: boolean): Promise<void> => {
      const next = { ...wanted.current, ...patch };
      wanted.current = next;
      setPrefs(next);
      setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!debounce) return save();
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, MORNING_TIME_DEBOUNCE_MS);
      return Promise.resolve();
    },
    [save],
  );

  // Leaving the screen with a time change still pending: save it now.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      void saveRef.current();
    },
    [],
  );

  return {
    prefs,
    error,
    setEnabled: (on) => change({ morningSummary: on }, false),
    setTime: (time) => void change({ morningTime: time }, true),
  };
}
