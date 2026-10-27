/**
 * Whenever auth has finished loading and there is NO session — an explicit
 * sign-out, an account deletion, or a session dropped at launch because it was
 * revoked elsewhere — removes the previous account's data from the device:
 * - our scheduled local notifications, delivered ones, and the widgets' timelines;
 * - the stored meal photos (`meals/`);
 * - our training-calendar events (and our calendar, if this app created it and it holds
 *   nothing else) plus that account's training-calendar settings. When the account is not
 *   known (session dropped before this run saw it), every account's leftovers go.
 * Idempotent, so running it on a fresh signed-out launch is harmless.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

import { clearTrainingCalendarData } from '../calendar/trainingCalendarSync';
import { clearMealPhotos } from '../camera/mealPhoto';
import { cancelLocalNotifications } from '../notifications';
import { clearWidgets } from '../widgets/sync';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

async function clearDeviceData(previousUserId: string | null): Promise<void> {
  const results = await Promise.allSettled([clearMealPhotos(), clearTrainingCalendarData(previousUserId)]);
  results.forEach((r) => {
    if (r.status === 'rejected') logger.warn('sign-out: device cleanup failed', r.reason);
  });
}

export function useSignedOutCleanup(isLoading: boolean, userId: string | null): void {
  /** The account signed in during this run, so its data can be found after it signs out. */
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (userId) {
      lastUserId.current = userId;
      return;
    }
    if (!isNative || isLoading) return;
    const previous = lastUserId.current;
    lastUserId.current = null;
    void cancelLocalNotifications();
    clearWidgets();
    void clearDeviceData(previous);
  }, [isLoading, userId]);
}
