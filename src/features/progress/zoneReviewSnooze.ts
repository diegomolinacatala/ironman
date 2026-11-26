/**
 * «Ahora no» on the zone-review card (Progreso) hides it for two weeks. The date is
 * stored on the device only (a suggestion, never server state): after it, a trend that
 * still holds shows the card again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { addDays } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { logger } from '@/lib/logger';

export const ZONE_REVIEW_SNOOZE_KEY = 'rti.zoneReview.snoozedUntil.v1';
export const ZONE_REVIEW_SNOOZE_DAYS = 14;

/** The day the card may show again after «Ahora no» on `today`. */
export function snoozeUntil(today: ISODate): ISODate {
  return addDays(today, ZONE_REVIEW_SNOOZE_DAYS);
}

/** Hidden while today is before the stored date (a malformed value never hides it). */
export function isSnoozed(until: string | null | undefined, today: ISODate): boolean {
  return typeof until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(until) && today < until;
}

export interface ZoneReviewSnooze {
  /** The stored date has been read (the card waits for it so it never flashes). */
  loaded: boolean;
  snoozed: boolean;
  /** «Ahora no»: hides the card for two weeks. */
  snooze: () => void;
}

export function useZoneReviewSnooze(today: ISODate): ZoneReviewSnooze {
  const [until, setUntil] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(ZONE_REVIEW_SNOOZE_KEY)
      .catch((error: unknown) => {
        logger.debug('zone review: could not read the snooze', error);
        return null;
      })
      .then((stored) => {
        if (!active) return;
        setUntil((current) => current ?? stored);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const snooze = useCallback(() => {
    const next = snoozeUntil(today);
    setUntil(next);
    setLoaded(true);
    AsyncStorage.setItem(ZONE_REVIEW_SNOOZE_KEY, next).catch((error: unknown) => {
      logger.debug('zone review: could not save the snooze', error);
    });
  }, [today]);

  return { loaded, snoozed: isSnoozed(until, today), snooze };
}
