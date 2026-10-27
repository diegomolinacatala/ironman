/**
 * Non-React side of the training calendar: sync the plan into EventKit, turn it on, remove
 * our data (switch off with "quitar", sign-out, account deletion). One job at a time.
 * iOS only; elsewhere every call is a no-op.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { addDays } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import { logger } from '@/lib/logger';

import { getCalendarPermission } from '../calendar';
import { createSerialQueue } from '../notifications/serial';
import { linkBaseFor } from '../widgets/props';
import { rangeToWindow } from './mapping';
import { applyCalendarPlan, ensureTrainingCalendar, removeTrainingCalendarData } from './trainingCalendarNative';
import { notifyTrainingCalendarChanged } from './trainingCalendarState';
import {
  readTrainingSettings,
  removeTrainingSettings,
  trainingSettingsUserIds,
  writeTrainingSettings,
  type TrainingCalendarSettings,
} from './trainingCalendarStore';
import { planCalendarSync, trainingCalendarWindow } from './trainingEvents';

/** Optional context: who is syncing and in which zone the plan's times are (profile). */
export interface CalendarSyncContext {
  userId?: string | null;
  timeZone?: string | null;
}

export interface CalendarSyncResult {
  created: number;
  updated: number;
  deleted: number;
}

export const isTrainingCalendarAvailable = Platform.OS === 'ios';
const NO_CHANGES: CalendarSyncResult = { created: 0, updated: 0, deleted: 0 };

/** One calendar job at a time; a superseded sync (newer one queued) does nothing. */
const calendarQueue = createSerialQueue();

function linkBase(): string {
  return linkBaseFor(Constants.expoConfig?.scheme);
}

function knownEventIds(settings: TrainingCalendarSettings): Set<string> {
  return new Set(Object.values(settings.events).map((link) => link.eventId));
}

/** Listing window: the sync window plus a day each side (profile zone ≠ device zone). */
function listingWindow(today: ISODate): { start: Date; end: Date } {
  const range = trainingCalendarWindow(today);
  return rangeToWindow({ from: addDays(range.from, -1), to: addDays(range.to, 1) });
}

async function runSync(
  userId: string,
  settings: TrainingCalendarSettings,
  input: { workouts: readonly Workout[]; today: ISODate; timeZone: string | null },
): Promise<CalendarSyncResult> {
  const { calendar, createdByApp } = await ensureTrainingCalendar(settings.calendarId, knownEventIds(settings));
  const window = listingWindow(input.today);
  const existing = await calendar.listEvents(window.start, window.end);
  const plan = planCalendarSync({
    workouts: input.workouts,
    today: input.today,
    existing,
    mapping: settings.events,
    alarmMinutes: settings.alarmMinutes,
    timeZone: input.timeZone,
    linkBase: linkBase(),
  });
  const applied = await applyCalendarPlan(calendar, existing, plan);
  // Re-read: the alarm or the switch may have changed while EventKit was busy.
  const latest = await readTrainingSettings(userId);
  await writeTrainingSettings(userId, {
    ...latest,
    calendarId: calendar.id,
    calendarTitle: calendar.title,
    createdByApp,
    events: applied.mapping,
    lastSync: new Date().toISOString(),
    timeZone: input.timeZone ?? latest.timeZone,
  });
  const result = { created: applied.created, updated: applied.updated, deleted: applied.deleted };
  logger.debug('training calendar: synced', { ...result, unchanged: plan.unchanged });
  return result;
}

/**
 * Upserts events for planned workouts in [today − 1, today + 21] and removes stale ones.
 * `workouts` must cover that whole window (missing ones are treated as deleted).
 * No-op when disabled, without permission, off iOS, or when the account is unknown
 * (`context.userId`, else the workouts' owner). Throws when EventKit fails as a whole.
 */
export async function syncWorkoutsToCalendar(
  workouts: Workout[],
  today: ISODate,
  context?: CalendarSyncContext,
): Promise<{ created: number; updated: number; deleted: number }> {
  const userId = context?.userId ?? workouts[0]?.userId ?? null;
  if (!isTrainingCalendarAvailable || !userId) return NO_CHANGES;
  const result = await calendarQueue.run(async (isCurrent) => {
    if (!isCurrent()) return NO_CHANGES;
    const settings = await readTrainingSettings(userId);
    if (!settings.enabled || (await getCalendarPermission()) !== 'granted') return NO_CHANGES;
    const timeZone = context?.timeZone ?? settings.timeZone;
    return runSync(userId, settings, { workouts, today, timeZone });
  });
  notifyTrainingCalendarChanged(userId);
  return result;
}

/** Finds / creates our calendar and turns sync on for `userId` (permission already granted). */
export async function turnOnTrainingCalendar(userId: string, timeZone: string | null): Promise<void> {
  await calendarQueue.run(async () => {
    const settings = await readTrainingSettings(userId);
    const { calendar, createdByApp } = await ensureTrainingCalendar(settings.calendarId, knownEventIds(settings));
    await writeTrainingSettings(userId, {
      ...settings,
      enabled: true,
      calendarId: calendar.id,
      calendarTitle: calendar.title,
      createdByApp,
      timeZone: timeZone ?? settings.timeZone,
    });
  });
  notifyTrainingCalendarChanged(userId);
}

/** Switches sync off; with `removeEvents`, deletes what we wrote (see `removeTrainingCalendarData`). */
export async function turnOffTrainingCalendar(userId: string, removeEvents: boolean): Promise<void> {
  const settings = await readTrainingSettings(userId);
  // Written first so a sync already queued finds it disabled.
  await writeTrainingSettings(userId, { ...settings, enabled: false });
  if (removeEvents && isTrainingCalendarAvailable && (await getCalendarPermission()) === 'granted') {
    await calendarQueue.run(async () => {
      const calendarGone = await removeTrainingCalendarData(settings.calendarId, knownEventIds(settings));
      const latest = await readTrainingSettings(userId);
      await writeTrainingSettings(userId, {
        ...latest,
        events: {},
        calendarId: calendarGone ? null : latest.calendarId,
        calendarTitle: calendarGone ? null : latest.calendarTitle,
        createdByApp: calendarGone ? false : latest.createdByApp,
      });
    });
  }
  notifyTrainingCalendarChanged(userId);
}

/**
 * Sign-out / account deletion: removes this account's events (and our calendar when we
 * created it and it holds nothing else) without asking for permission, then forgets its
 * settings on the device. `userId` null = every account with state here (a session that
 * was dropped before we could see who it was).
 */
export async function clearTrainingCalendarData(userId: string | null): Promise<void> {
  const userIds = userId ? [userId] : await trainingSettingsUserIds();
  for (const id of userIds) {
    await calendarQueue.run(async () => {
      const settings = await readTrainingSettings(id);
      const canTouch = isTrainingCalendarAvailable && settings.calendarId && (await getCalendarPermission()) === 'granted';
      if (canTouch) {
        await removeTrainingCalendarData(settings.calendarId, knownEventIds(settings)).catch((error: unknown) =>
          logger.warn('training calendar: sign-out cleanup failed', error),
        );
      }
      await removeTrainingSettings(id);
    });
    notifyTrainingCalendarChanged(id);
  }
}
