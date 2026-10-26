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
import type { Repository } from '@/data/repository';
import { logger } from '@/lib/logger';
import { readJson, removeKey, StorageKeys, writeJson } from '@/lib/storage';

export type DeviceStateKey = 'healthEnabled' | 'healthLastSync' | 'healthImported' | 'calendarIds' | 'calendarLastSync';

export const DEVICE_STATE_KEYS: readonly DeviceStateKey[] = [
  'healthEnabled',
  'healthLastSync',
  'healthImported',
  'calendarIds',
  'calendarLastSync',
];

/** AsyncStorage key of `key` for `userId` ("rti.health.enabled.user.<id>"). */
export function userScopedKey(key: DeviceStateKey, userId: string): string {
  if (!userId) throw new Error('userScopedKey: missing user id');
  return `${StorageKeys[key]}.user.${userId}`;
}

export function readUserJson<T>(key: DeviceStateKey, userId: string, fallback: T): Promise<T> {
  return readJson<T>(userScopedKey(key, userId), fallback);
}

export function writeUserJson(key: DeviceStateKey, userId: string, value: unknown): Promise<void> {
  return writeJson(userScopedKey(key, userId), value);
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
