/**
 * Routes notification taps (local and push) to `data.url`, including the tap
 * that cold-started the app. Waits until the user is signed in + onboarded and
 * the navigator is mounted, so the entry gate redirect does not swallow it.
 */
import * as Notifications from 'expo-notifications';
import { router, useNavigationContainerRef, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

import { configureNotifications } from '../notifications';
import { urlFromNotificationData } from '../notifications/schedule';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
/** Lets the index gate finish its own redirect before we push. */
const SETTLE_MS = 600;
const RETRY_MS = 250;
const MAX_RETRIES = 20;
/** Tab routes (v2: Hoy, Plan, Tú). `/together` and `/progress` live in the root stack now. */
const TAB_PATH = /^\/(today|week|me)\/?(?:[?#].*)?$/;

export function useNotificationRouting(ready: boolean): void {
  const navigation = useNavigationContainerRef();
  const pending = useRef<string | null>(null);
  const readyRef = useRef(ready);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = (delay: number, attempt = 0) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const url = pending.current;
      if (!url || !readyRef.current) return;
      if (!navigation.isReady()) {
        if (attempt < MAX_RETRIES) schedule(RETRY_MS, attempt + 1);
        return;
      }
      pending.current = null;
      try {
        // Tab destinations switch tabs instead of stacking a second copy of the tab navigator.
        if (TAB_PATH.test(url)) router.navigate(url as Href);
        else router.push(url as Href);
      } catch (error) {
        logger.warn('notifications: could not open link', error);
      }
      Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }, delay);
  };

  useEffect(() => {
    readyRef.current = ready;
    if (ready && pending.current) schedule(SETTLE_MS);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isNative) return undefined;
    configureNotifications();
    let active = true;
    const enqueue = (data: unknown, delay: number) => {
      const url = urlFromNotificationData(data);
      if (!url) return;
      pending.current = url;
      schedule(delay);
    };
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response) enqueue(response.notification.request.content.data, SETTLE_MS);
      })
      .catch((error: unknown) => logger.warn('notifications: last response failed', error));
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      enqueue(response.notification.request.content.data, 0),
    );
    return () => {
      active = false;
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
