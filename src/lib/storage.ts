import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from './logger';

/** Namespaced keys for device-local preferences (never server state). */
export const StorageKeys = {
  demoDb: 'rti.demo.db.v1',
  demoSession: 'rti.demo.session.v1',
  healthEnabled: 'rti.health.enabled',
  healthLastSync: 'rti.health.lastSync',
  healthImported: 'rti.health.imported.v1',
  calendarIds: 'rti.calendar.ids',
  calendarLastSync: 'rti.calendar.lastSync',
  pushToken: 'rti.push.token',
  coachHistory: 'rti.coach.history',
} as const;

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch (error) {
    logger.warn(`storage read failed: ${key}`, error);
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    logger.warn(`storage write failed: ${key}`, error);
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    logger.warn(`storage remove failed: ${key}`, error);
  }
}
