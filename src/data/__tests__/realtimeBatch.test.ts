import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { REALTIME_BATCH_MS, createInvalidationBatcher, rootsOf } from '../queries';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('realtime invalidation batching', () => {
  test('a burst of events refetches each affected root once', () => {
    const flush = jest.fn<(roots: string[]) => void>();
    const batcher = createInvalidationBatcher(flush);
    for (let i = 0; i < 12; i += 1) batcher.push('workouts');
    batcher.push('joint_sessions');
    expect(flush).not.toHaveBeenCalled();
    jest.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    const roots = flush.mock.calls[0]?.[0] ?? [];
    expect(roots.filter((r) => r === 'workouts')).toHaveLength(1);
    expect(roots).toEqual(expect.arrayContaining(['workouts', 'joint_sessions', 'friend_week']));
  });

  test('a later event starts a new window; cancel drops what is pending', () => {
    const flush = jest.fn<(roots: string[]) => void>();
    const batcher = createInvalidationBatcher(flush);
    batcher.push('checkins');
    jest.advanceTimersByTime(REALTIME_BATCH_MS);
    batcher.push('metrics');
    jest.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(flush.mock.calls.map((c) => c[0])).toEqual([['checkins'], ['metrics']]);
    batcher.push('feed');
    batcher.cancel();
    jest.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  test('rootsOf deduplicates across topics', () => {
    expect(rootsOf(['workouts', 'busy_blocks'])).toEqual(['workouts', 'workout', 'workout_analysis', 'friend_week', 'busy_blocks']);
  });
});
