import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from './logger';

/** Namespaced keys for device-local preferences (never server state). */
export const StorageKeys = {
  demoDb: 'rebufo.demo.db.v1',
  demoSession: 'rebufo.demo.session.v1',
  healthEnabled: 'rebufo.health.enabled',
  healthLastSync: 'rebufo.health.lastSync',
  healthImported: 'rebufo.health.imported.v1',
  calendarIds: 'rebufo.calendar.ids',
  calendarLastSync: 'rebufo.calendar.lastSync',
  pushToken: 'rebufo.push.token',
  coachHistory: 'rebufo.coach.history',
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
