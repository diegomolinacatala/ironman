/**
 * Mirrors the plan into the OS: rolling local notifications and widget
 * timelines. Debounced so a burst of query updates triggers one rebuild.
 */
import { useEffect } from 'react';

import type { ISODate, JointSession, Profile, Race, Workout } from '@/domain/types';
import { logger } from '@/lib/logger';

import { rescheduleLocalNotifications } from '../notifications';
import { syncWidgets } from '../widgets/sync';

const DEBOUNCE_MS = 1500;

export interface PlanSnapshot {
  workouts: Workout[] | undefined;
  races: Race[] | undefined;
  jointSessions: JointSession[] | undefined;
  profile: Profile | null;
  today: ISODate;
  /** Bumped when the app becomes active so time-dependent output is refreshed. */
  tick: number;
}

export function usePlanMirrors(enabled: boolean, snapshot: PlanSnapshot): void {
  const { workouts, races, jointSessions, profile, today, tick } = snapshot;

  useEffect(() => {
    if (!enabled || !profile || !workouts) return undefined;
    const timer = setTimeout(() => {
      rescheduleLocalNotifications({ workouts, profile, today })
        .then((count) => logger.debug(`notifications: ${count} scheduled`))
        .catch((error: unknown) => logger.warn('notifications: reschedule failed', error));
      syncWidgets({ workouts, races: races ?? [], jointSessions: jointSessions ?? [], profile, today });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, workouts, races, jointSessions, profile, today, tick]);
}
