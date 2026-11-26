/**
 * Notifications: permissions, APNs push registration (iOS devices only) and the
 * local schedule (reminders, "Tu informe de hoy" → /briefing?play=1, evening check-in,
 * Sunday planning).
 * Web: everything is a safe no-op.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Repository } from '@/data/repository';
import type { ISODate, Profile, RaceDistance, Workout } from '@/domain/types';
import { logger } from '@/lib/logger';
import { StorageKeys, writeJson } from '@/lib/storage';

import {
  buildSchedule,
  isLocalNotificationKind,
  isOwnNotificationKind,
  wakeBriefingSpec,
  type BedtimeReminder,
  type NotificationSpec,
} from './notifications/schedule';
import { createSerialQueue } from './notifications/serial';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/** Serialises reschedules and the sign-out cancel (latest call wins). */
const localQueue = createSerialQueue();

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
let configured = false;

function toPermissionState(status: string): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

async function registerCategories(): Promise<void> {
  await Promise.all([
    Notifications.setNotificationCategoryAsync('workout', [
      { identifier: 'open', buttonTitle: 'Ver entreno', options: { opensAppToForeground: true } },
    ]),
    Notifications.setNotificationCategoryAsync('checkin', [
      { identifier: 'open', buttonTitle: 'Registrar', options: { opensAppToForeground: true } },
    ]),
    Notifications.setNotificationCategoryAsync('summary', [
      { identifier: 'open', buttonTitle: 'Escuchar', options: { opensAppToForeground: true } },
    ]),
    Notifications.setNotificationCategoryAsync('weekly', []),
    Notifications.setNotificationCategoryAsync('calm', [
      { identifier: 'open', buttonTitle: 'Respirar', options: { opensAppToForeground: true } },
    ]),
  ]);
}

/** Foreground presentation (banner + list, no sound) and categories. Idempotent. */
export function configureNotifications(): void {
  if (!isNative || configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  registerCategories().catch((error: unknown) => logger.warn('notifications: categories failed', error));
}

export async function getNotificationPermission(): Promise<PermissionState> {
  if (!isNative) return 'denied';
  try {
    return toPermissionState((await Notifications.getPermissionsAsync()).status);
  } catch (error) {
    logger.warn('notifications: permission check failed', error);
    return 'undetermined';
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return result.status === 'granted';
  } catch (error) {
    logger.error('notifications: permission request failed', error);
    return false;
  }
}

/** APNs device tokens are hex strings (length not guaranteed by Apple). */
const APNS_TOKEN_PATTERN = /^[0-9a-f]+$/i;

/** The raw APNs token from `getDevicePushTokenAsync`, or null when it is not one. */
export function apnsTokenFrom(deviceToken: Notifications.DevicePushToken): string | null {
  if (deviceToken.type !== 'ios' || typeof deviceToken.data !== 'string') return null;
  const token = deviceToken.data.trim();
  return APNS_TOKEN_PATTERN.test(token) ? token.toLowerCase() : null;
}

/**
 * Gets this iPhone's raw APNs device token (the `push-dispatch` function sends
 * straight to Apple, no Expo push service) and stores it server-side. Asks for
 * permission only when it was never asked. Returns null (without throwing) on
 * web, Android, simulators, denied permission, an unexpected token or network
 * errors.
 *
 * The token is saved in `StorageKeys.pushToken` BEFORE the server call so the
 * data layer can always unregister it on sign-out / account deletion (deleting
 * a token that never got registered is a harmless no-op).
 */
export async function registerForPush(repo: Repository): Promise<string | null> {
  if (Platform.OS !== 'ios' || !Device.isDevice) return null;
  try {
    let status = await getNotificationPermission();
    if (status === 'undetermined') status = (await requestNotificationPermission()) ? 'granted' : 'denied';
    if (status !== 'granted') return null;
    const token = apnsTokenFrom(await Notifications.getDevicePushTokenAsync());
    if (!token) {
      logger.warn('notifications: unexpected device push token, push disabled');
      return null;
    }
    await writeJson(StorageKeys.pushToken, token);
    await repo.registerPushToken(token, 'ios');
    return token;
  } catch (error) {
    logger.warn('notifications: push registration failed', error);
    return null;
  }
}

function toRequest(spec: NotificationSpec): Notifications.NotificationRequestInput {
  const trigger: Notifications.NotificationTriggerInput =
    spec.trigger.type === 'date'
      ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: spec.trigger.date }
      : { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: spec.trigger.hour, minute: spec.trigger.minute };
  return {
    identifier: spec.id,
    content: {
      title: spec.title,
      body: spec.body,
      data: { kind: spec.kind, url: spec.url },
      categoryIdentifier: spec.categoryId,
      threadIdentifier: spec.threadId,
      interruptionLevel: 'active',
    },
    trigger,
  };
}

/** The rolling window's notifications; with `includeWake`, also the wake-up briefing (sign-out). */
async function cancelOurScheduled(includeWake = false): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const isOurs = includeWake ? isOwnNotificationKind : isLocalNotificationKind;
  const ours = scheduled.filter((r) => isOurs(r.content.data?.kind));
  await Promise.all(ours.map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)));
}

/**
 * Rebuilds the rolling local schedule from the plan. Only our notifications
 * (identified by `data.kind`) are cancelled. Returns how many were scheduled
 * (0 when a newer reschedule or a sign-out cancel superseded this call).
 */
export async function rescheduleLocalNotifications(input: {
  workouts: Workout[];
  profile: Profile;
  today: ISODate;
  /** jointSessionId → partners' names, for "Quedada con David en 1 h". */
  jointPartners?: Readonly<Record<string, string>>;
  /** Distance of the target race: what race-pace targets mean in the reminder body. */
  raceDistance?: RaceDistance | null;
  /** The server sends the briefing in wake mode (backend configured): no fixed-time one here. */
  serverWake?: boolean;
  /** Today's stress-and-sleep signal: the bedtime reminder (null = none today). */
  bedtime?: BedtimeReminder | null;
}): Promise<number> {
  if (!isNative) return 0;
  return localQueue.run(async (isCurrent) => {
    if (!isCurrent()) return 0;
    await cancelOurScheduled();
    if (!isCurrent() || (await getNotificationPermission()) !== 'granted' || !isCurrent()) return 0;
    const specs = buildSchedule({
      workouts: input.workouts,
      prefs: input.profile.notificationPrefs,
      today: input.today,
      now: new Date(),
      jointPartners: input.jointPartners,
      thresholds: input.profile.thresholds ?? null,
      raceDistance: input.raceDistance ?? null,
      serverWake: input.serverWake,
      bedtime: input.bedtime ?? null,
    });
    const results = await Promise.allSettled(specs.map((spec) => Notifications.scheduleNotificationAsync(toRequest(spec))));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) logger.warn(`notifications: ${failed.length} could not be scheduled`, failed[0]);
    return results.length - failed.length;
  });
}

/**
 * Sign-out: cancels every local notification we scheduled (after any reschedule
 * still running) and removes delivered ones from Notification Center, which may
 * show the previous account's plan or friends' invites.
 */
export async function cancelLocalNotifications(): Promise<void> {
  if (!isNative) return;
  await localQueue.run(async () => {
    const results = await Promise.allSettled([cancelOurScheduled(true), Notifications.dismissAllNotificationsAsync()]);
    results.forEach((r) => {
      if (r.status === 'rejected') logger.warn('notifications: sign-out cleanup failed', r.reason);
    });
  });
}

/**
 * Wake mode, Apple Salud path: "Tu informe de hoy" at `fireAt` (replaces today's if any; a
 * moment already past fires in a few seconds). False without permission or on failure.
 */
export async function scheduleWakeBriefing(date: ISODate, fireAt: Date): Promise<boolean> {
  if (!isNative) return false;
  try {
    if ((await getNotificationPermission()) !== 'granted') return false;
    const soon = new Date(Date.now() + 5_000);
    const spec = wakeBriefingSpec(date, fireAt.getTime() > soon.getTime() ? fireAt : soon);
    await Notifications.scheduleNotificationAsync(toRequest(spec));
    return true;
  } catch (error) {
    logger.warn('notifications: wake briefing could not be scheduled', error);
    return false;
  }
}
