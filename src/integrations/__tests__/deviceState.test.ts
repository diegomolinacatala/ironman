/**
 * Device opt-ins are per account: a second account on the same phone must not
 * inherit the first one's Apple Salud opt-in, calendars or imported ids.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { StorageKeys } from '@/lib/storage';

import { getCalendarLastSync, getSelectedCalendarIds, setSelectedCalendarIds } from '../calendar';
import { assertSessionUser, removeLegacyDeviceKeys, sessionUserId, userScopedKey } from '../deviceState';
import {
  getHealthLastSync,
  getImportedHealthIds,
  isHealthEnabled,
  rememberImportedHealthIds,
  setHealthEnabled,
  setHealthLastSync,
} from '../health/state';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const ANA = 'user-ana';
const BEA = 'user-bea';

function authOf(userId: string | null | Error) {
  return {
    auth: {
      getSession: async () => {
        if (userId instanceof Error) throw userId;
        return userId ? { userId, email: null } : null;
      },
    },
  } as never;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('per-account device state', () => {
  test('enabling Apple Salud for one account does not enable it for another', async () => {
    await setHealthEnabled(ANA, true);
    await setHealthLastSync(ANA, '2026-10-26T08:00:00.000Z');
    expect(await isHealthEnabled(ANA)).toBe(true);
    expect(await getHealthLastSync(ANA)).toBe('2026-10-26T08:00:00.000Z');
    expect(await isHealthEnabled(BEA)).toBe(false);
    expect(await getHealthLastSync(BEA)).toBeNull();
  });

  test('selected calendars and their last sync belong to one account', async () => {
    await setSelectedCalendarIds(ANA, ['cal-1', 'cal-1', 'cal-2']);
    expect(await getSelectedCalendarIds(ANA)).toEqual(['cal-1', 'cal-2']);
    expect(await getSelectedCalendarIds(BEA)).toEqual([]);
    expect(await getCalendarLastSync(BEA)).toBeNull();
  });

  test('imported HealthKit ids are remembered per account', async () => {
    await rememberImportedHealthIds(ANA, new Set(), ['hk-1']);
    expect([...(await getImportedHealthIds(ANA))]).toEqual(['hk-1']);
    expect([...(await getImportedHealthIds(BEA))]).toEqual([]);
  });

  test('legacy device-wide keys are dropped, namespaced ones are kept', async () => {
    await AsyncStorage.setItem(StorageKeys.healthEnabled, 'true');
    await AsyncStorage.setItem(StorageKeys.calendarIds, '["cal-1"]');
    await AsyncStorage.setItem(StorageKeys.pushToken, '"deadbeef02"');
    await setHealthEnabled(ANA, true);

    await removeLegacyDeviceKeys();

    expect(await AsyncStorage.getItem(StorageKeys.healthEnabled)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.calendarIds)).toBeNull();
    // The push token is device-wide on purpose: the data layer unregisters it on sign-out.
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).not.toBeNull();
    expect(await isHealthEnabled(ANA)).toBe(true);
  });

  test('keys are namespaced and never built without a user', () => {
    expect(userScopedKey('healthEnabled', ANA)).toBe(`${StorageKeys.healthEnabled}.user.${ANA}`);
    expect(() => userScopedKey('healthEnabled', '')).toThrow();
  });
});

describe('session helpers', () => {
  test('sessionUserId reads the repository session and tolerates failures', async () => {
    expect(await sessionUserId(authOf(ANA))).toBe(ANA);
    expect(await sessionUserId(authOf(null))).toBeNull();
    expect(await sessionUserId(authOf(new Error('offline')))).toBeNull();
  });

  test('assertSessionUser rejects when the account changed', async () => {
    await expect(assertSessionUser(authOf(ANA), ANA)).resolves.toBeUndefined();
    await expect(assertSessionUser(authOf(BEA), ANA)).rejects.toThrow('La sesión cambió');
  });
});
