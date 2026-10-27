/**
 * Device calendar (EventKit) → busy blocks. Uses the SDK 58 object API of
 * expo-calendar (legacy `*Async` functions would throw). Web: no-op.
 * The calendar selection is per account (see `./deviceState`).
 * Our own "Road to Ironman" calendar (the workouts we write, see
 * `calendar/trainingCalendar.ts`) is never listed nor read as busy time.
 */
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import type { Repository } from '@/data/repository';
import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { DateRange } from '@/domain/types';
import { logger } from '@/lib/logger';

import { mapEventsToBusyBlocks, rangeToWindow } from './calendar/mapping';
import { getKnownTrainingCalendarIds, isTrainingCalendar } from './calendar/trainingCalendarStore';
import { assertSessionUser, readUserJson, sessionUserId, writeUserJson } from './deviceState';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface DeviceCalendar {
  id: string;
  title: string;
  color: string | null;
  /** Account name ("iCloud", "Gmail", "Universidad"...). */
  source: string;
}

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

function toPermissionState(status: string): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function getCalendarPermission(): Promise<PermissionState> {
  if (!isNative) return 'denied';
  try {
    return toPermissionState((await Calendar.getCalendarPermissions()).status);
  } catch (error) {
    logger.warn('calendar: permission check failed', error);
    return 'undetermined';
  }
}

export async function requestCalendarPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    return (await Calendar.requestCalendarPermissions()).status === 'granted';
  } catch (error) {
    logger.error('calendar: permission request failed', error);
    return false;
  }
}

/** Event calendars the user can pick for busy time (never our own training calendar). */
async function readableCalendars(): Promise<Calendar.ExpoCalendar[]> {
  const [calendars, known] = await Promise.all([
    Calendar.getCalendars(Calendar.EntityTypes.EVENT),
    getKnownTrainingCalendarIds(),
  ]);
  return calendars.filter((c) => !isTrainingCalendar(c, known));
}

export async function listDeviceCalendars(): Promise<DeviceCalendar[]> {
  if (!isNative || (await getCalendarPermission()) !== 'granted') return [];
  const calendars = await readableCalendars();
  return calendars
    .map((c) => ({ id: c.id, title: c.title, color: c.color ?? null, source: c.source?.name ?? '' }))
    .sort((a, b) => a.source.localeCompare(b.source, 'es') || a.title.localeCompare(b.title, 'es'));
}

/** Calendars this account chose to read on this device. */
export async function getSelectedCalendarIds(userId: string): Promise<string[]> {
  const value = await readUserJson<unknown>('calendarIds', userId, []);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export async function setSelectedCalendarIds(userId: string, ids: string[]): Promise<void> {
  await writeUserJson('calendarIds', userId, [...new Set(ids)]);
}

export async function getCalendarLastSync(userId: string): Promise<string | null> {
  const value = await readUserJson<unknown>('calendarLastSync', userId, null);
  return typeof value === 'string' ? value : null;
}

/** Current week (Monday) through next Sunday. */
export function defaultBusyRange(today: string = todayISO()): DateRange {
  const from = startOfWeek(today);
  return { from, to: addDays(from, 13) };
}

/**
 * Replaces the signed-in user's `device_calendar` busy blocks in `range` with
 * the events of the calendars THAT account selected. An empty selection clears them.
 */
export async function syncCalendarBusy(repo: Repository, range: DateRange = defaultBusyRange()): Promise<{ blocks: number }> {
  if (!isNative) return { blocks: 0 };
  const userId = await sessionUserId(repo);
  if (!userId) return { blocks: 0 };
  if ((await getCalendarPermission()) !== 'granted') return { blocks: 0 };

  const selected = await getSelectedCalendarIds(userId);
  const available = new Set((await readableCalendars()).map((c) => c.id));
  const ids = selected.filter((id) => available.has(id));
  const window = rangeToWindow(range);

  const events = ids.length > 0 ? await Calendar.listEvents(ids, window.start, window.end) : [];
  const blocks = mapEventsToBusyBlocks(events, window);
  await assertSessionUser(repo, userId);
  await repo.replaceBusyBlocks(range, 'device_calendar', blocks);
  await writeUserJson('calendarLastSync', userId, new Date().toISOString());
  return { blocks: blocks.length };
}
