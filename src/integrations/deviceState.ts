/**
 * Device-local integration state is kept PER ACCOUNT.
 *
 * The Apple Salud opt-in, the selected calendars, the last-sync stamps and the
 * imported workout ids live in AsyncStorage under keys namespaced by the
 * signed-in user id. The iOS HealthKit / EventKit grants belong to the app, not
 * to an account, so without this a second account on the same phone would
 * silently inherit (and upload) the first person's health data and calendar.
 *
 * The push token is device-wide on purpose (`StorageKeys.pushToken`): the data
 * layer reads it on sign-out to unregister it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Repository } from '@/data/repository';
import { logger } from '@/lib/logger';
import { readJson, removeKey, StorageKeys, writeJson } from '@/lib/storage';

type LegacyDeviceStateKey = 'healthEnabled' | 'healthLastSync' | 'healthImported' | 'calendarIds' | 'calendarLastSync';

/** Keys that only ever existed per account (never device-wide), so there is nothing legacy to remove. */
const SCOPED_ONLY_KEYS = {
  /** "Añadir mis entrenos al calendario" settings + workout → event mapping (`calendar/trainingCalendarStore`). */
  trainingCalendar: 'rti.trainingCalendar.v1',
} as const;

export type DeviceStateKey = LegacyDeviceStateKey | keyof typeof SCOPED_ONLY_KEYS;

/** Keys that were device-wide before state was namespaced (see `removeLegacyDeviceKeys`). */
export const DEVICE_STATE_KEYS: readonly LegacyDeviceStateKey[] = [
  'healthEnabled',
  'healthLastSync',
  'healthImported',
  'calendarIds',
  'calendarLastSync',
];

function baseKey(key: DeviceStateKey): string {
  return key === 'trainingCalendar' ? SCOPED_ONLY_KEYS.trainingCalendar : StorageKeys[key];
}

/** AsyncStorage key of `key` for `userId` ("rti.health.enabled.user.<id>"). */
export function userScopedKey(key: DeviceStateKey, userId: string): string {
  if (!userId) throw new Error('userScopedKey: missing user id');
  return `${baseKey(key)}.user.${userId}`;
}

export function readUserJson<T>(key: DeviceStateKey, userId: string, fallback: T): Promise<T> {
  return readJson<T>(userScopedKey(key, userId), fallback);
}

export function writeUserJson(key: DeviceStateKey, userId: string, value: unknown): Promise<void> {
  return writeJson(userScopedKey(key, userId), value);
}

export function removeUserKey(key: DeviceStateKey, userId: string): Promise<void> {
  return removeKey(userScopedKey(key, userId));
}

/** Accounts that have `key` stored on this device (e.g. to clean up after a sign-out we did not see). */
export async function userIdsWithKey(key: DeviceStateKey): Promise<string[]> {
  const prefix = `${baseKey(key)}.user.`;
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((k) => k.startsWith(prefix) && k.length > prefix.length).map((k) => k.slice(prefix.length));
  } catch (error) {
    logger.warn('integrations: could not list stored keys', error);
    return [];
  }
}

/**
 * Removes the device-wide keys written before state was namespaced. They cannot
 * be attributed to an account, so the user simply re-enables the integration.
 */
export async function removeLegacyDeviceKeys(): Promise<void> {
  await Promise.all(DEVICE_STATE_KEYS.map((key) => removeKey(StorageKeys[key])));
}

/** User id of the repository's current session, or null when signed out. */
export async function sessionUserId(repo: Pick<Repository, 'auth'>): Promise<string | null> {
  try {
    return (await repo.auth.getSession())?.userId ?? null;
  } catch (error) {
    logger.warn('integrations: could not read the session', error);
    return null;
  }
}

/** Throws when the account changed while a device sync was running (never write A's data into B). */
export async function assertSessionUser(repo: Pick<Repository, 'auth'>, userId: string): Promise<void> {
  if ((await sessionUserId(repo)) !== userId) {
    throw new Error('La sesión cambió durante la sincronización.');
  }
}
