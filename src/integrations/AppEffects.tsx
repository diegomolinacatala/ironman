/**
 * Invisible component mounted once in the root layout. When the user is signed
 * in and onboarded (native only):
 * - registers the APNs device push token (once per signed-in account),
 * - routes notification taps to `data.url` (also on cold start),
 * - on mount / foreground (throttled 10 min): Apple Salud + calendar syncs,
 *   only for what THIS account enabled on this device,
 * - on mount / foreground: Garmin sync when its last sync is older than an hour
 *   (server-side, so also on web),
 * - keeps local notifications, widgets (incl. today's briefing headline) and the
 *   "Road to Ironman" device calendar in sync with the plan.
 * Widget deep links (roadtoironman://workout/<id>, roadtoironman://today) are handled by
 * Expo Router itself. Whenever there is no session (sign-out, deletion, revoked
 * session at launch) it clears local notifications and widgets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth, useRepository } from '@/data/context';
import { useBriefing, useJointSessions, useProfile, useRaces, useWorkouts } from '@/data/queries';
import { maxDate, minDate, todayISO } from '@/domain/dates';
import type { DateRange, ISODate } from '@/domain/types';

import { defaultBusyRange } from './calendar';
import { trainingCalendarWindow } from './calendar/trainingEvents';
import { removeLegacyDeviceKeys } from './deviceState';
import { useForegroundSync } from './effects/useForegroundSync';
import { useGarminForegroundSync } from './effects/useGarminSync';
import { useNotificationRouting } from './effects/useNotificationRouting';
import { usePlanMirrors } from './effects/usePlanMirrors';
import { usePushRegistration } from './effects/usePushRegistration';
import { useSignedOutCleanup } from './effects/useSignedOutCleanup';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/** Workouts every mirror needs: this + next week (widgets, notifications) ∪ [today − 1, today + 21] (calendar). */
function mirrorRange(today: ISODate): DateRange {
  const busy = defaultBusyRange(today);
  const calendar = trainingCalendarWindow(today);
  return { from: minDate(busy.from, calendar.from), to: maxDate(busy.to, calendar.to) };
}

export function AppEffects(): null {
  const repo = useRepository();
  const { session, isLoading } = useAuth();
  const userId = session?.userId ?? null;
  const profile = useProfile().data ?? null;
  const signedInAndOnboarded = Boolean(userId && profile?.onboardedAt);
  const ready = isNative && signedInAndOnboarded;

  const [today, setToday] = useState(() => todayISO());
  const [tick, setTick] = useState(0);
  const range = useMemo(() => defaultBusyRange(today), [today]);
  const workoutRange = useMemo(() => mirrorRange(today), [today]);
  const workouts = useWorkouts(workoutRange).data;
  const races = useRaces().data;
  const jointSessions = useJointSessions(range).data;
  const briefingData = useBriefing(today).data ?? null;
  const briefingDate = briefingData?.date ?? null;
  const briefingHeadline = briefingData?.headline ?? null;
  const briefing = useMemo(
    () => (briefingDate && briefingHeadline ? { date: briefingDate, headline: briefingHeadline } : null),
    [briefingDate, briefingHeadline],
  );

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
  useGarminForegroundSync(signedInAndOnboarded, repo, userId);
  usePlanMirrors(ready, { workouts, races, jointSessions, profile, briefing, userId, today, tick });
  useSignedOutCleanup(isLoading, userId);

  return null;
}
