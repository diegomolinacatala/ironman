/**
 * `syncHealth` with a mocked HealthKit: only the account that enabled Apple
 * Salud on this device gets data, the permission sheet asks only for read
 * types, and nothing is written if the account changes mid-sync.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MetricsDraft, Workout } from '@/domain/types';

import { emptyHealthResult } from '../health/result';
import { getHealthSources, setHealthEnabled } from '../health/state';
import { HEALTH_READ_TYPES, syncHealth } from '../healthkit';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockRequestAuthorization = jest.fn(async (_opts: unknown) => true);
const mockQueryStats = jest.fn(async (..._args: unknown[]) => [
  { startDate: new Date(), averageQuantity: { quantity: 48, unit: 'count/min' }, sumQuantity: { quantity: 8000, unit: 'count' } },
]);

const mockQuerySleep = jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []);

jest.mock('@kingstinct/react-native-healthkit', () => ({
  isHealthDataAvailable: () => true,
  requestAuthorization: (opts: unknown) => mockRequestAuthorization(opts),
  queryStatisticsCollectionForQuantity: (...args: unknown[]) => mockQueryStats(...args),
  queryCategorySamples: (...args: unknown[]) => mockQuerySleep(...args),
  queryWorkoutSamples: async () => [],
}));

const ANA = 'user-ana';
const BEA = 'user-bea';

function fakeRepo(sessionUsers: string[]) {
  let call = 0;
  const upserted: MetricsDraft[][] = [];
  const repo = {
    auth: {
      getSession: async () => {
        const userId = sessionUsers[Math.min(call, sessionUsers.length - 1)] ?? null;
        call += 1;
        return userId ? { userId, email: null } : null;
      },
    },
    upsertMetrics: async (drafts: MetricsDraft[]) => {
      upserted.push(drafts);
    },
    listWorkouts: async (): Promise<Workout[]> => [],
    createWorkout: async () => {
      throw new Error('unexpected');
    },
    completeWorkout: async () => {
      throw new Error('unexpected');
    },
  };
  return { repo: repo as never, upserted };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('syncHealth', () => {
  test('does nothing for an account that never enabled Apple Salud on this device', async () => {
    await setHealthEnabled(ANA, true);
    const { repo, upserted } = fakeRepo([BEA]);
    expect(await syncHealth(repo)).toEqual(emptyHealthResult());
    expect(mockQueryStats).not.toHaveBeenCalled();
    expect(upserted).toEqual([]);
  });

  test('uploads metrics for the account that opted in, asking only for read types', async () => {
    await setHealthEnabled(ANA, true);
    const { repo, upserted } = fakeRepo([ANA]);
    const result = await syncHealth(repo, { days: 1 });
    expect(result.metricsDays).toBe(1);
    expect(upserted).toHaveLength(1);
    const requested = (mockRequestAuthorization.mock.calls[0]?.[0] ?? {}) as { toRead?: readonly string[]; toShare?: unknown };
    expect(requested.toShare).toBeUndefined();
    expect(requested.toRead).toEqual(HEALTH_READ_TYPES);
  });

  test('counts the nights of sleep and names the apps that wrote them (COROS), remembering them', async () => {
    await setHealthEnabled(ANA, true);
    const today = new Date();
    const asleep = { startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 30), value: 1 };
    mockQuerySleep.mockResolvedValueOnce([
      { ...asleep, endDate: new Date(asleep.startDate.getTime() + 6 * 3_600_000), sourceRevision: { source: { name: ' COROS ' } } },
      { ...asleep, endDate: new Date(asleep.startDate.getTime() + 5 * 3_600_000), sourceRevision: { source: { name: 'COROS' } } },
    ]);
    const { repo } = fakeRepo([ANA]);
    const result = await syncHealth(repo, { days: 1 });
    expect(result).toMatchObject({ metricsDays: 1, sleepNights: 1, activitiesFound: 0, sources: ['COROS'] });
    expect(await getHealthSources(ANA)).toEqual(['COROS']);
    expect(await getHealthSources(BEA)).toEqual([]);
  });

  test('never writes when the account changed while HealthKit was being read', async () => {
    await setHealthEnabled(ANA, true);
    const { repo, upserted } = fakeRepo([ANA, BEA]);
    await expect(syncHealth(repo, { days: 1 })).rejects.toThrow('La sesión cambió');
    expect(upserted).toEqual([]);
  });
});

describe('HEALTH_READ_TYPES', () => {
  test('only lists types the sync reads (no active energy)', () => {
    expect(HEALTH_READ_TYPES).not.toContain('HKQuantityTypeIdentifierActiveEnergyBurned');
    expect([...HEALTH_READ_TYPES].sort()).toEqual(
      [
        'HKCategoryTypeIdentifierSleepAnalysis',
        'HKQuantityTypeIdentifierHeartRate',
        'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
        'HKQuantityTypeIdentifierRestingHeartRate',
        'HKQuantityTypeIdentifierStepCount',
        'HKQuantityTypeIdentifierVO2Max',
        'HKWorkoutTypeIdentifier',
      ].sort(),
    );
  });
});
