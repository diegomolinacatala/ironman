/**
 * App-wide snapshot of "Añadir mis entrenos al calendario" for the signed-in account, shared
 * by every `useTrainingCalendar()` (Hoy's "En tu calendario ✓" badge, settings, onboarding).
 * Refreshed when a screen mounts, when the app comes back to the foreground and after every
 * sync / enable / disable / sign-out cleanup.
 */
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

import { logger } from '@/lib/logger';

import { getCalendarPermission, type PermissionState } from '../calendar';
import {
  DEFAULT_TRAINING_SETTINGS,
  readTrainingSettings,
  TRAINING_CALENDAR_TITLE,
  type TrainingCalendarSettings,
} from './trainingCalendarStore';

export interface SharedTrainingCalendarState {
  /** Account this snapshot belongs to. */
  userId: string | null;
  permission: PermissionState;
  enabled: boolean;
  calendarTitle: string | null;
  alarmMinutes: number;
  lastSync: string | null;
  /** Workouts that currently have an event in the calendar (as of the last sync). */
  syncedWorkoutIds: string[];
}

const isIOS = Platform.OS === 'ios';

function fromSettings(userId: string | null, permission: PermissionState, settings: TrainingCalendarSettings): SharedTrainingCalendarState {
  return {
    userId,
    permission,
    enabled: settings.enabled,
    calendarTitle: settings.enabled ? (settings.calendarTitle ?? TRAINING_CALENDAR_TITLE) : null,
    alarmMinutes: settings.alarmMinutes,
    lastSync: settings.lastSync,
    syncedWorkoutIds: Object.keys(settings.events),
  };
}

export function emptyTrainingCalendarState(userId: string | null): SharedTrainingCalendarState {
  return fromSettings(userId, 'undetermined', DEFAULT_TRAINING_SETTINGS);
}

let current: SharedTrainingCalendarState = emptyTrainingCalendarState(null);
let generation = 0;
const listeners = new Set<() => void>();
let appStateSubscription: NativeEventSubscription | null = null;

export function getTrainingCalendarSnapshot(): SharedTrainingCalendarState {
  return current;
}

function publish(next: SharedTrainingCalendarState): void {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Re-reads permission + this account's settings. The latest call wins. */
export async function refreshTrainingCalendarState(userId: string | null): Promise<void> {
  generation += 1;
  const mine = generation;
  const [permission, settings] = await Promise.all([
    isIOS ? getCalendarPermission() : Promise.resolve<PermissionState>('denied'),
    userId ? readTrainingSettings(userId) : Promise.resolve(DEFAULT_TRAINING_SETTINGS),
  ]);
  if (mine === generation) publish(fromSettings(userId, permission, settings));
}

/** Refreshes the shared snapshot if it belongs to `userId` (after a background sync / cleanup). */
export function notifyTrainingCalendarChanged(userId: string): void {
  if (current.userId !== userId) return;
  refreshTrainingCalendarState(userId).catch((error: unknown) => logger.warn('training calendar: refresh failed', error));
}

/** `useSyncExternalStore` subscription; the first subscriber also watches app focus. */
export function subscribeTrainingCalendar(listener: () => void): () => void {
  listeners.add(listener);
  if (!appStateSubscription) {
    // Permission can change in iOS Settings while the app is in background.
    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && current.userId) notifyTrainingCalendarChanged(current.userId);
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && appStateSubscription) {
      appStateSubscription.remove();
      appStateSubscription = null;
    }
  };
}

/** Tests: back to the initial snapshot. */
export function resetTrainingCalendarState(): void {
  generation += 1;
  current = emptyTrainingCalendarState(null);
}
