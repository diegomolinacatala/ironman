import { describe, expect, test } from '@jest/globals';

import type { CompletedData, DateRange, Workout, WorkoutDraft } from '@/domain/types';

import {
  importActivities,
  isLikelyDuplicate,
  toImportCandidate,
  type HealthActivity,
  type HealthRepo,
} from '../health/importer';
import { workout } from './fixtures';

const RANGE: DateRange = { from: '2026-10-20', to: '2026-10-26' };

function activity(overrides: Partial<HealthActivity> = {}): HealthActivity {
  return {
    uuid: 'hk-1',
    activityType: 37,
    start: new Date(2026, 9, 26, 18, 35),
    end: new Date(2026, 9, 26, 19, 27),
    durationMin: 52.4,
    distanceM: 10120.7,
    avgHr: 148.6,
    ...overrides,
  };
}

/** In-memory fake implementing the repository subset used by the importer. */
function fakeRepo(initial: Workout[]): HealthRepo & { workouts: () => Workout[] } {
  let store = [...initial];
  let seq = 0;
  return {
    workouts: () => store,
    listWorkouts: async () => store,
    createWorkout: async (draft: WorkoutDraft) => {
      seq += 1;
      const created = workout({ ...draft, id: `new-${seq}`, startTime: draft.startTime ?? null, description: draft.description ?? null, distanceM: draft.distanceM ?? null, tss: draft.tss ?? null, steps: [], isKey: false, source: draft.source ?? 'manual' });
      store = [...store, created];
      return created;
    },
    completeWorkout: async (id: string, data: CompletedData) => {
      const current = store.find((w) => w.id === id);
      if (!current) throw new Error('not found');
      const done: Workout = { ...current, status: 'completed', completed: data };
      store = store.map((w) => (w.id === id ? done : w));
      return done;
    },
  };
}

describe('toImportCandidate', () => {
  test('normalises a HealthKit run', () => {
    expect(toImportCandidate(activity())).toEqual({
      externalId: 'hk-1',
      date: '2026-10-26',
      startTime: '18:35',
      sport: 'run',
      title: 'Carrera',
      durationMin: 52,
      distanceM: 10121,
      avgHr: 149,
      completedAt: new Date(2026, 9, 26, 19, 27).toISOString(),
    });
  });

  test('drops walks and very short activities', () => {
    expect(toImportCandidate(activity({ activityType: 52 }))).toBeNull();
    expect(toImportCandidate(activity({ durationMin: 4 }))).toBeNull();
  });
});

describe('isLikelyDuplicate', () => {
  const candidate = toImportCandidate(activity());
  if (!candidate) throw new Error('fixture');

  test('same external id is a duplicate', () => {
    const w = workout({ id: 'a', date: '2026-10-26', status: 'completed', completed: { externalId: 'hk-1' } });
    expect(isLikelyDuplicate(candidate, [w])).toBe(true);
  });

  test('a Garmin-synced workout with similar time and duration is a duplicate', () => {
    const w = workout({ id: 'g', date: '2026-10-26', startTime: '18:30', status: 'completed', source: 'garmin', completed: { durationMin: 50, source: 'garmin' } });
    expect(isLikelyDuplicate(candidate, [w])).toBe(true);
  });

  test('a different sport or a planned workout is not a duplicate', () => {
    const swim = workout({ id: 's', date: '2026-10-26', sport: 'swim', status: 'completed', durationMin: 52 });
    const planned = workout({ id: 'p', date: '2026-10-26', startTime: '18:30', durationMin: 50 });
    expect(isLikelyDuplicate(candidate, [swim, planned])).toBe(false);
  });
});

describe('importActivities', () => {
  test('completes the matching planned workout', async () => {
    const planned = workout({ id: 'plan-1', date: '2026-10-26', startTime: '18:30', durationMin: 50 });
    const repo = fakeRepo([planned]);
    const result = await importActivities(repo, [toImportCandidate(activity())!], { range: RANGE, knownIds: new Set() });
    expect(result).toEqual({ workoutsCompleted: 1, activitiesImported: 0, handledIds: ['hk-1'] });
    const done = repo.workouts().find((w) => w.id === 'plan-1');
    expect(done?.status).toBe('completed');
    expect(done?.completed).toMatchObject({ source: 'healthkit', externalId: 'hk-1', durationMin: 52, distanceM: 10121, avgHr: 149 });
  });

  test('creates a completed unplanned workout when nothing matches', async () => {
    const repo = fakeRepo([]);
    const padel = toImportCandidate(activity({ uuid: 'hk-2', activityType: 34, durationMin: 90 }))!;
    const result = await importActivities(repo, [padel], { range: RANGE, knownIds: new Set() });
    expect(result.activitiesImported).toBe(1);
    const created = repo.workouts()[0];
    expect(created).toMatchObject({ sport: 'other', title: 'Pádel / raqueta', source: 'healthkit', status: 'completed' });
    expect(created?.completed?.externalId).toBe('hk-2');
  });

  test('a completion that fails after create is finished on the next sync, not left planned', async () => {
    const repo = fakeRepo([]);
    let failCompletion = true;
    const flaky: HealthRepo = {
      ...repo,
      completeWorkout: async (id, data) => {
        if (failCompletion) throw new Error('network');
        return repo.completeWorkout(id, data);
      },
    };
    const padel = toImportCandidate(activity({ uuid: 'hk-9', activityType: 34, durationMin: 90 }))!;

    const first = await importActivities(flaky, [padel], { range: RANGE, knownIds: new Set() });
    expect(first.handledIds).toEqual([]);
    expect(repo.workouts()).toHaveLength(1);
    expect(repo.workouts()[0]).toMatchObject({ status: 'planned', externalId: 'healthkit:hk-9' });

    failCompletion = false;
    const second = await importActivities(flaky, [padel], { range: RANGE, knownIds: new Set() });
    expect(second).toEqual({ workoutsCompleted: 0, activitiesImported: 1, handledIds: ['hk-9'] });
    expect(repo.workouts()).toHaveLength(1);
    expect(repo.workouts()[0]).toMatchObject({ status: 'completed', completed: { externalId: 'hk-9', source: 'healthkit' } });
  });

  test('an orphaned import is never used to match a different activity', async () => {
    const orphan = workout({ id: 'orphan', date: '2026-10-26', startTime: '18:35', durationMin: 52, title: 'Carrera', source: 'healthkit', externalId: 'healthkit:hk-old' });
    const repo = fakeRepo([orphan]);
    const other = toImportCandidate(activity({ uuid: 'hk-new' }))!;
    const result = await importActivities(repo, [other], { range: RANGE, knownIds: new Set() });
    expect(result).toEqual({ workoutsCompleted: 0, activitiesImported: 1, handledIds: ['hk-new'] });
    expect(repo.workouts().find((w) => w.id === 'orphan')?.status).toBe('planned');
  });

  test('a completed or skipped import with the same external id is still a duplicate', () => {
    const candidate = toImportCandidate(activity({ uuid: 'hk-5' }))!;
    const skipped = workout({ id: 's', date: '2026-10-26', status: 'skipped', externalId: 'healthkit:hk-5' });
    const planned = workout({ id: 'p', date: '2026-10-26', status: 'planned', externalId: 'healthkit:hk-5' });
    expect(isLikelyDuplicate(candidate, [skipped])).toBe(true);
    expect(isLikelyDuplicate(candidate, [planned])).toBe(false);
  });

  test('skips already imported ids and duplicates, continues after failures', async () => {
    const repo = fakeRepo([]);
    const failing: HealthRepo = {
      ...repo,
      createWorkout: async (draft) => {
        if (draft.sport === 'swim') throw new Error('network');
        return repo.createWorkout(draft);
      },
    };
    const known = toImportCandidate(activity({ uuid: 'old' }))!;
    const swim = toImportCandidate(activity({ uuid: 'swim', activityType: 46, start: new Date(2026, 9, 25, 7, 0), end: new Date(2026, 9, 25, 7, 45), durationMin: 45 }))!;
    const bike = toImportCandidate(activity({ uuid: 'bike', activityType: 13, start: new Date(2026, 9, 24, 9, 0), end: new Date(2026, 9, 24, 11, 0), durationMin: 120 }))!;
    const result = await importActivities(failing, [known, swim, bike], { range: RANGE, knownIds: new Set(['old']) });
    expect(result.activitiesImported).toBe(1);
    expect(result.handledIds).toEqual(['bike']);
  });
});
