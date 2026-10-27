/**
 * Mirrors the plan into the OS: rolling local notifications, widget timelines (including
 * today's briefing headline) and the "Road to Ironman" device calendar. Debounced so a
 * burst of query updates triggers one rebuild.
 */
import { useEffect } from 'react';

import type { ISODate, JointSession, Profile, Race, Workout } from '@/domain/types';
import { logger } from '@/lib/logger';

import { syncWorkoutsToCalendar } from '../calendar/trainingCalendar';
import { rescheduleLocalNotifications } from '../notifications';
import { syncWidgets } from '../widgets/sync';

const DEBOUNCE_MS = 1500;
/** EventKit writes are heavier: wait a little longer so plan edits settle first. */
export const CALENDAR_DEBOUNCE_MS = 2000;

export interface PlanSnapshot {
  /** Must cover [today − 1, today + 21] for the calendar (and this + next week for the rest). */
  workouts: Workout[] | undefined;
  races: Race[] | undefined;
  jointSessions: JointSession[] | undefined;
  profile: Profile | null;
  /** Today's briefing for the lock-screen widget (null until generated). */
  briefing: { date: ISODate; headline: string } | null;
  userId: string | null;
  today: ISODate;
  /** Bumped when the app becomes active so time-dependent output is refreshed. */
  tick: number;
}

export function usePlanMirrors(enabled: boolean, snapshot: PlanSnapshot): void {
  const { workouts, races, jointSessions, profile, briefing, userId, today, tick } = snapshot;
  const timeZone = profile?.timezone ?? null;

  useEffect(() => {
    if (!enabled || !profile || !workouts) return undefined;
    const timer = setTimeout(() => {
      rescheduleLocalNotifications({ workouts, profile, today })
        .then((count) => logger.debug(`notifications: ${count} scheduled`))
        .catch((error: unknown) => logger.warn('notifications: reschedule failed', error));
      syncWidgets({ workouts, races: races ?? [], jointSessions: jointSessions ?? [], profile, today, briefing });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, workouts, races, jointSessions, profile, today, tick, briefing]);

  // No-op unless this account turned "Añadir mis entrenos al calendario" on.
  useEffect(() => {
    if (!enabled || !workouts || !userId) return undefined;
    const timer = setTimeout(() => {
      syncWorkoutsToCalendar(workouts, today, { userId, timeZone })
        .then((result) => logger.debug('training calendar: mirrored', result))
        .catch((error: unknown) => logger.warn('training calendar: sync failed', error));
    }, CALENDAR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, workouts, today, tick, userId, timeZone]);
}
