/**
 * Local notification scheduling against a fake expo-notifications store:
 * a sign-out cancel can never be overtaken by an older reschedule, and the
 * push token is stored for the data layer's sign-out cleanup.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { StorageKeys } from '@/lib/storage';

import { cancelLocalNotifications, registerForPush, rescheduleLocalNotifications } from '../notifications';
import { createSerialQueue } from '../notifications/serial';
import { prefs, workout } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

interface Scheduled {
  identifier: string;
  content: { data: Record<string, unknown> };
}

let mockStore: Scheduled[] = [];
let mockPermission: () => Promise<{ status: string }> = async () => ({ status: 'granted' });
const mockDismissAll = jest.fn(async () => undefined);

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
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[abc]' }),
  setNotificationHandler: () => undefined,
  setNotificationCategoryAsync: async () => undefined,
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { easConfig: { projectId: 'project-1' }, expoConfig: {} } }));

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
  jest.clearAllMocks();
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
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBe(JSON.stringify('ExponentPushToken[abc]'));
  });

  test('registers the token server-side and keeps it in StorageKeys.pushToken', async () => {
    const repo = { registerPushToken: jest.fn(async (_token: string, _platform: string) => undefined) };
    expect(await registerForPush(repo as never)).toBe('ExponentPushToken[abc]');
    expect(repo.registerPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]', 'ios');
    expect(await AsyncStorage.getItem(StorageKeys.pushToken)).toBe(JSON.stringify('ExponentPushToken[abc]'));
  });
});
