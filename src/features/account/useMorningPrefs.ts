import { useCallback, useEffect, useRef, useState } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { ISOTime, NotificationPrefs, Profile } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { DEFAULT_MORNING_TIME } from '../onboarding/onboardingModel';

/** The iOS compact time picker reports every wheel step: wait for the athlete to settle. */
export const MORNING_TIME_DEBOUNCE_MS = 600;

export type MorningPrefs = Pick<NotificationPrefs, 'morningSummary' | 'morningTime' | 'morningMode' | 'wakeDelayMin' | 'wakeWindow'>;

/** The wake-mode settings this section changes (mode and delay; the window is edited in Notificaciones). */
export type WakePatch = Partial<Pick<NotificationPrefs, 'morningMode' | 'wakeDelayMin' | 'wakeWindow'>>;

/**
 * What this section owns. Not the wake-up window: it is edited in Notificaciones, and carrying
 * a stale copy here would overwrite it on the next save.
 */
function morningOf(profile: Profile): MorningPrefs {
  const p = profile.notificationPrefs;
  return {
    morningSummary: p.morningSummary,
    morningTime: p.morningTime || DEFAULT_MORNING_TIME,
    ...(p.morningMode ? { morningMode: p.morningMode } : {}),
    ...(p.wakeDelayMin !== undefined ? { wakeDelayMin: p.wakeDelayMin } : {}),
  };
}

export interface MorningPrefsState {
  prefs: MorningPrefs;
  error: string | null;
  setEnabled: (on: boolean) => Promise<void>;
  setTime: (time: ISOTime) => void;
  /** Mode ('fixed' | 'wake') and delay: saved at once. */
  setWake: (patch: WakePatch) => Promise<void>;
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
  const { morningSummary, morningTime, morningMode, wakeDelayMin } = profile.notificationPrefs;

  // Follow changes made elsewhere (Notificaciones screen, another device) while nothing is pending here.
  useEffect(() => {
    if (inFlight.current > 0 || timer.current) return;
    const next = morningOf(profileRef.current);
    wanted.current = next;
    setPrefs(next);
  }, [morningSummary, morningTime, morningMode, wakeDelayMin]);

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
    setWake: (patch) => change(patch, false),
  };
}
