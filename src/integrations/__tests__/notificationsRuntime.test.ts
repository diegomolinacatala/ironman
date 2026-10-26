/**
 * Local notification scheduling against a fake expo-notifications store:
 * a sign-out cancel can never be overtaken by an older reschedule, and the
 * push token is stored for the data layer's sign-out cleanup.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { StorageKeys } from '@/lib/storage';

import { apnsTokenFrom, cancelLocalNotifications, registerForPush, rescheduleLocalNotifications } from '../notifications';
import { createSerialQueue } from '../notifications/serial';
import { prefs, workout } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

interface Scheduled {
  identifier: string;
  content: { data: Record<string, unknown> };
}

const APNS_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

let mockStore: Scheduled[] = [];
let mockPermission: () => Promise<{ status: string }> = async () => ({ status: 'granted' });
let mockIsDevice = true;
const mockDismissAll = jest.fn(async () => undefined);
const mockDeviceToken = jest.fn(async (): Promise<{ type: string; data: unknown }> => ({ type: 'ios', data: APNS_TOKEN }));

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date', DAILY: 'daily' },
  getAllScheduledNotificationsAsync: async () => [...mockStore],
  cancelScheduledNotificationAsync: async (id: string) => {
    mockStore = mockStore.filter((n) => n.identifier !== id);
  },
  scheduleNotificationAsync: async (req: { identifier: string; content: { data: Record<string, unknown> } }) => {
    mockStore = [...mockStore.filter((n) => n.identifier !== req.identifier), { identifier: req.identifier, content: req.content }];
    return req.identifier;
  },
  getPermissionsAsync: () => mockPermission(),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  dismissAllNotificationsAsync: () => mockDismissAll(),
  getDevicePushTokenAsync: () => mockDeviceToken(),
  setNotificationHandler: () => undefined,
  setNotificationCategoryAsync: async () => undefined,
}));
jest.mock('expo-device', () => ({
  __esModule: true,
  get isDevice() {
    return mockIsDevice;
  },
}));

const TODAY = '2026-10-26';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function profileInput() {
  const now = new Date();
  const date = `${now.getFullYear() + 1}-01-15`;
  return {
    workouts: [workout({ id: 'w1', date, startTime: '18:30' })],
    profile: { notificationPrefs: prefs } as never,
    today: date,
  };
}

beforeEach(async () => {
  mockStore = [];
  mockPermission = async () => ({ status: 'granted' });
  mockIsDevice = true;
  jest.clearAllMocks();
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('createSerialQueue', () => {
  test('runs jobs in call order and flags superseded ones', async () => {
    const queue = createSerialQueue();
    const gate = deferred<void>();
    const order: string[] = [];
    const first = queue.run(async (isCurrent) => {
      await gate.promise;
      order.push(`first:${isCurrent()}`);
    });
    const second = queue.run(async (isCurrent) => {
      order.push(`second:${isCurrent()}`);
    });
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:false', 'second:true']);
  });

  test('a failing job does not block the next one', async () => {
    const queue = createSerialQueue();
    const failing = queue.run(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('local notifications vs sign-out', () => {
  test('a cancel issued while a reschedule awaits the OS leaves nothing scheduled', async () => {
    const permission = deferred<{ status: string }>();
    mockPermission = () => permission.promise;
    const reschedule = rescheduleLocalNotifications(profileInput());
    await Promise.resolve();
    const cancel = cancelLocalNotifications();
    permission.resolve({ status: 'granted' });
    await expect(reschedule).resolves.toBe(0);
    await cancel;
    expect(mockStore).toEqual([]);
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
  });

  test('a reschedule followed by a cancel ends with nothing scheduled', async () => {
    const reschedule = rescheduleLocalNotifications(profileInput());
    const cancel = cancelLocalNotifications();
    await Promise.all([reschedule, cancel]);
    expect(mockStore).toEqual([]);
  });

  test('the latest reschedule wins', async () => {
    const older = rescheduleLocalNotifications(profileInput());
    const newer = rescheduleLocalNotifications({ ...profileInput(), workouts: [] });
    await expect(older).resolves.toBe(0);
    const count = await newer;
    expect(count).toBeGreaterThan(0);
    expect(mockStore.some((n) => n.content.data.kind === 'workout_reminder')).toBe(false);
  });
});

describe('registerForPush', () => {
  test('stores the token for the sign-out cleanup even if the server call fails', async () => {
    const repo = {
      registerPushToken: jest.fn(async () => {
        throw new Error('offline');
      }),
    };
    expect(await registerForPush(repo as never)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBe(JSON.stringify(APNS_TOKEN));
  });

  test('registers the raw APNs device token server-side and keeps it in StorageKeys.pushToken', async () => {
    const repo = { registerPushToken: jest.fn(async (_token: string, _platform: string) => undefined) };
    expect(await registerForPush(repo as never)).toBe(APNS_TOKEN);
    expect(mockDeviceToken).toHaveBeenCalledTimes(1);
    expect(repo.registerPushToken).toHaveBeenCalledWith(APNS_TOKEN, 'ios');
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBe(JSON.stringify(APNS_TOKEN));
  });

  test('skips simulators without asking for a token', async () => {
    mockIsDevice = false;
    const repo = { registerPushToken: jest.fn(async () => undefined) };
    expect(await registerForPush(repo as never)).toBeNull();
    expect(mockDeviceToken).not.toHaveBeenCalled();
    expect(repo.registerPushToken).not.toHaveBeenCalled();
  });

  test.each(['android', 'web'] as const)('skips %s without asking for a token', async (os) => {
    jest.replaceProperty(Platform, 'OS', os);
    const repo = { registerPushToken: jest.fn(async () => undefined) };
    expect(await registerForPush(repo as never)).toBeNull();
    expect(mockDeviceToken).not.toHaveBeenCalled();
    expect(repo.registerPushToken).not.toHaveBeenCalled();
  });

  test('does not register when permission is denied', async () => {
    mockPermission = async () => ({ status: 'denied' });
    const repo = { registerPushToken: jest.fn(async () => undefined) };
    expect(await registerForPush(repo as never)).toBeNull();
    expect(mockDeviceToken).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBeNull();
  });

  test('ignores an unexpected token without storing or registering it', async () => {
    mockDeviceToken.mockResolvedValueOnce({ type: 'android', data: 'fcm-token' });
    const repo = { registerPushToken: jest.fn(async () => undefined) };
    expect(await registerForPush(repo as never)).toBeNull();
    expect(repo.registerPushToken).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBeNull();
  });
});

describe('apnsTokenFrom', () => {
  test('accepts iOS hex tokens (normalised to lower case) and rejects anything else', () => {
    expect(apnsTokenFrom({ type: 'ios', data: ` ${APNS_TOKEN.toUpperCase()} ` })).toBe(APNS_TOKEN);
    expect(apnsTokenFrom({ type: 'ios', data: 'ExponentPushToken[abc]' })).toBeNull();
    expect(apnsTokenFrom({ type: 'ios', data: '' })).toBeNull();
    expect(apnsTokenFrom({ type: 'android', data: APNS_TOKEN })).toBeNull();
  });
});
