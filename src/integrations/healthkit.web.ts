/**
 * Web stub for the Apple Health integration (HealthKit only exists on iOS).
 * Same exports as `healthkit.ts`; nothing here touches native modules.
 */
import type { Repository } from '@/data/repository';

import type { SleepWindow } from './health/mapping';
import { emptyHealthResult, type HealthSyncResult } from './health/result';

export { getHealthLastSync, isHealthEnabled, setHealthEnabled } from './health/state';
export type { HealthSyncResult } from './health/result';

export function isHealthAvailable(): boolean {
  return false;
}

export async function requestHealthPermissions(): Promise<boolean> {
  return false;
}

export async function syncHealth(_repo: Repository, _opts?: { days?: number }): Promise<HealthSyncResult> {
  return emptyHealthResult();
}

export async function readLastNight(_repo: Repository, _now?: Date): Promise<SleepWindow | null> {
  return null;
}
