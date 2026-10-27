/**
 * Writes planned workouts into a dedicated "Road to Ironman" calendar on the device (EventKit),
 * with an alarm before each session, and keeps it in sync (create / update / delete).
 *
 * - Window [today − 1, today + 21]; rules and formats in `trainingEvents.ts` (pure).
 * - Only events whose signature changed are rewritten; vanished events are recreated.
 * - Settings and the workout → event mapping are per account (`trainingCalendarStore.ts`).
 * - Never deletes a calendar it did not create (`trainingCalendarNative.ts`).
 * - The busy-time reader (`../calendar.ts`) never reads this calendar.
 * - State is shared by every `useTrainingCalendar()` (`trainingCalendarState.ts`).
 * - iOS only; web / Android report `available: false` and every call is a no-op.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useAuth, useRepository } from '@/data/context';
import { useProfile } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { logger } from '@/lib/logger';

import { getCalendarPermission, requestCalendarPermission } from '../calendar';
import {
  emptyTrainingCalendarState,
  getTrainingCalendarSnapshot,
  refreshTrainingCalendarState,
  subscribeTrainingCalendar,
} from './trainingCalendarState';
import { clampAlarmMinutes, readTrainingSettings, writeTrainingSettings } from './trainingCalendarStore';
import {
  isTrainingCalendarAvailable,
  syncWorkoutsToCalendar,
  turnOffTrainingCalendar,
  turnOnTrainingCalendar,
} from './trainingCalendarSync';
import { trainingCalendarWindow } from './trainingEvents';

export { syncWorkoutsToCalendar, type CalendarSyncContext, type CalendarSyncResult } from './trainingCalendarSync';

export interface TrainingCalendarState {
  /** False on web / when EventKit is unavailable. */
  available: boolean;
  permission: 'granted' | 'denied' | 'undetermined';
  /** The user turned "Añadir mis entrenos al calendario" on. */
  enabled: boolean;
  calendarTitle: string | null;
  /** Alarm before each workout, minutes (0 = none). */
  alarmMinutes: number;
  lastSync: string | null;
  /** Workouts that currently have an event in the calendar (for "En tu calendario ✓"). */
  syncedWorkoutIds: string[];
  busy: boolean;
  error: string | null;
}

export interface TrainingCalendar extends TrainingCalendarState {
  /** Asks calendar permission if needed, creates/finds the calendar, turns sync on and syncs. Resolves false when denied. */
  enable(): Promise<boolean>;
  disable(opts?: { removeEvents?: boolean }): Promise<void>;
  setAlarmMinutes(minutes: number): Promise<void>;
  syncNow(): Promise<void>;
}

const MESSAGES = {
  unavailable: 'El calendario solo está disponible en el iPhone.',
  signedOut: 'Inicia sesión para añadir tus entrenos al calendario.',
  denied: 'Sin acceso a tu calendario. Actívalo en Ajustes > Apps > Road to Ironman > Calendarios (acceso total).',
  enableFailed: 'No se pudo crear el calendario «Road to Ironman». Inténtalo de nuevo.',
  syncFailed: 'No se pudo actualizar tu calendario. Inténtalo de nuevo.',
  disableFailed: 'No se pudieron quitar tus entrenos del calendario. Inténtalo de nuevo.',
} as const;

async function hasCalendarAccess(): Promise<boolean> {
  return (await getCalendarPermission()) === 'granted' || (await requestCalendarPermission());
}

/** Local `busy` / `error` of the instance that runs an action; failures become `message`. */
function useAction(userId: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(fallback: T, message: string, job: () => Promise<T>): Promise<T> => {
      setBusy(true);
      setError(null);
      try {
        return await job();
      } catch (err) {
        logger.warn('training calendar: action failed', err);
        setError(message);
        return fallback;
      } finally {
        setBusy(false);
        await refreshTrainingCalendarState(userId).catch(() => undefined);
      }
    },
    [userId],
  );
  return { busy, error, setError, run };
}

export function useTrainingCalendar(): TrainingCalendar {
  const repo = useRepository();
  const userId = useAuth().session?.userId ?? null;
  const timeZone = useProfile().data?.timezone ?? null;
  const shared = useSyncExternalStore(subscribeTrainingCalendar, getTrainingCalendarSnapshot, getTrainingCalendarSnapshot);
  const view = shared.userId === userId ? shared : emptyTrainingCalendarState(userId);
  const { busy, error, setError, run } = useAction(userId);

  useEffect(() => {
    refreshTrainingCalendarState(userId).catch((err: unknown) => logger.warn('training calendar: refresh failed', err));
  }, [userId]);

  const syncFor = useCallback(
    async (user: string) => {
      const today = todayISO();
      const workouts = await repo.listWorkouts(trainingCalendarWindow(today));
      await syncWorkoutsToCalendar(workouts, today, { userId: user, timeZone });
    },
    [repo, timeZone],
  );

  const syncNow = useCallback(
    () =>
      run(undefined, MESSAGES.syncFailed, async () => {
        if (userId) await syncFor(userId);
      }),
    [run, syncFor, userId],
  );

  const enable = useCallback(
    () =>
      run(false, MESSAGES.enableFailed, async () => {
        const blocked = !isTrainingCalendarAvailable ? MESSAGES.unavailable : !userId ? MESSAGES.signedOut : null;
        if (blocked || !userId) {
          setError(blocked);
          return false;
        }
        if (!(await hasCalendarAccess())) {
          setError(MESSAGES.denied);
          return false;
        }
        await turnOnTrainingCalendar(userId, timeZone);
        // On even if the first sync fails (offline…): AppEffects retries when the plan changes.
        await syncFor(userId).catch((err: unknown) => logger.warn('training calendar: first sync failed', err));
        return true;
      }),
    [run, setError, syncFor, userId, timeZone],
  );

  const disable = useCallback(
    (opts?: { removeEvents?: boolean }) =>
      run(undefined, MESSAGES.disableFailed, async () => {
        if (userId) await turnOffTrainingCalendar(userId, opts?.removeEvents === true);
      }),
    [run, userId],
  );

  const setAlarmMinutes = useCallback(
    (minutes: number) =>
      run(undefined, MESSAGES.syncFailed, async () => {
        if (!userId) return;
        const settings = await readTrainingSettings(userId);
        await writeTrainingSettings(userId, { ...settings, alarmMinutes: clampAlarmMinutes(minutes) });
        if (settings.enabled) await syncFor(userId);
      }),
    [run, syncFor, userId],
  );

  return {
    available: isTrainingCalendarAvailable,
    permission: view.permission,
    enabled: view.enabled,
    calendarTitle: view.calendarTitle,
    alarmMinutes: view.alarmMinutes,
    lastSync: view.lastSync,
    syncedWorkoutIds: view.syncedWorkoutIds,
    busy,
    error,
    enable,
    disable,
    setAlarmMinutes,
    syncNow,
  };
}
