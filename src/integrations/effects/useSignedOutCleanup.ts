/**
 * Whenever auth has finished loading and there is NO session — an explicit
 * sign-out, an account deletion, or a session dropped at launch because it was
 * revoked elsewhere — removes the previous account's data from the OS: our
 * scheduled local notifications, delivered ones, and the widgets' timelines.
 * Idempotent, so running it on a fresh signed-out launch is harmless.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { cancelLocalNotifications } from '../notifications';
import { clearWidgets } from '../widgets/sync';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export function useSignedOutCleanup(isLoading: boolean, userId: string | null): void {
  useEffect(() => {
    if (!isNative || isLoading || userId) return;
    void cancelLocalNotifications();
    clearWidgets();
  }, [isLoading, userId]);
}
