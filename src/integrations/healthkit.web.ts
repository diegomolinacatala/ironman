/**
 * Web stub for the Apple Health integration (HealthKit only exists on iOS).
 * Same exports as `healthkit.ts`; nothing here touches native modules.
 */
import type { Repository } from '@/data/repository';

export { getHealthLastSync, isHealthEnabled, setHealthEnabled } from './health/state';

export interface HealthSyncResult {
  metricsDays: number;
  workoutsCompleted: number;
  activitiesImported: number;
}

export function isHealthAvailable(): boolean {
  return false;
}

export async function requestHealthPermissions(): Promise<boolean> {
  return false;
}

export async function syncHealth(_repo: Repository, _opts?: { days?: number }): Promise<HealthSyncResult> {
  return { metricsDays: 0, workoutsCompleted: 0, activitiesImported: 0 };
}
