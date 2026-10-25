/**
 * Invisible component mounted once in the root layout. When the user is signed
 * in and onboarded (native only):
 * - registers the Expo push token (once per signed-in account),
 * - routes notification taps to `data.url` (also on cold start),
 * - on mount / foreground (throttled 10 min): Apple Salud + calendar syncs,
 *   only for what THIS account enabled on this device,
 * - keeps local notifications and widgets in sync with the plan.
 * Widget deep links (rebufo://workout/<id>, rebufo://today) are handled by
 * Expo Router itself. Whenever there is no session (sign-out, deletion, revoked
 * session at launch) it clears local notifications and widgets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth, useRepository } from '@/data/context';
import { useJointSessions, useProfile, useRaces, useWorkouts } from '@/data/queries';
import { todayISO } from '@/domain/dates';

import { defaultBusyRange } from './calendar';
import { removeLegacyDeviceKeys } from './deviceState';
import { useForegroundSync } from './effects/useForegroundSync';
import { useNotificationRouting } from './effects/useNotificationRouting';
import { usePlanMirrors } from './effects/usePlanMirrors';
import { usePushRegistration } from './effects/usePushRegistration';
import { useSignedOutCleanup } from './effects/useSignedOutCleanup';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export function AppEffects(): null {
  const repo = useRepository();
  const { session, isLoading } = useAuth();
  const userId = session?.userId ?? null;
  const profile = useProfile().data ?? null;
  const ready = isNative && Boolean(userId && profile?.onboardedAt);

  const [today, setToday] = useState(() => todayISO());
  const [tick, setTick] = useState(0);
  const range = useMemo(() => defaultBusyRange(today), [today]);
  const workouts = useWorkouts(range).data;
  const races = useRaces().data;
  const jointSessions = useJointSessions(range).data;

  const onActive = useCallback(() => {
    setToday(todayISO());
    setTick((t) => t + 1);
  }, []);

  // Device-wide opt-ins from before per-account storage cannot be attributed to anyone.
  useEffect(() => {
    void removeLegacyDeviceKeys();
  }, []);

  usePushRegistration(ready, userId, repo);
  useNotificationRouting(ready);
  useForegroundSync(ready, repo, userId, onActive);
  usePlanMirrors(ready, { workouts, races, jointSessions, profile, today, tick });
  useSignedOutCleanup(isLoading, userId);

  return null;
}
