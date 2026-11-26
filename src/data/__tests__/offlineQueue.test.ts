/**
 * The check-in and «Hecho» kept on the phone without connection: the persisted
 * queue, the save-or-queue decision and the flush. The demo repository never
 * fails, so the network errors here are simulated with a fake repository.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CheckinDraft, CompletedData, DailyCheckin, Workout } from '@/domain/types';
import { makeWorkout } from '@/domain/__tests__/fixtures';

import {
  checkinKey,
  completeKey,
  enqueueOffline,
  getOfflineItems,
  loadOfflineQueue,
  offlineWritesSettled,
  parseOfflineItems,
  removeOfflineKey,
  resetOfflineQueueForTests,
  storageKeyFor,
  type OfflineItem,
} from '../offline/offlineQueue';
import { completionToSend, flushOfflineQueue, saveOrQueue, type FlushRepo, type SentValue } from '../offline/offlineSync';
import { RepositoryError } from '../repository';

const ME = 'me';
const OTHER = 'someone-else';
const DRAFT: CheckinDraft = { date: '2026-11-26', sleepQuality: 4, sleepHours: 7.5, fatigue: 2, soreness: 2, stress: 2, motivation: 4, notes: null };
const DONE: CompletedData = { durationMin: 50, rpe: 4, feel: 4, source: 'manual', completedAt: '2026-11-26T07:30:00.000Z' };

const offline = () => new RepositoryError('network', 'Sin conexión. Revisa tu internet e inténtalo de nuevo.');

function checkinItem(draft: CheckinDraft = DRAFT) {
  return { kind: 'checkin' as const, key: checkinKey(draft.date), draft };
}

function completeItem(workoutId: string, data: CompletedData = DONE) {
  return { kind: 'complete' as const, key: completeKey(workoutId), workoutId, data };
}

/** A repository whose answers each test scripts (rejecting = no connection, refused…). */
function fakeRepo(workouts: Workout[] = []) {
  const server = new Map(workouts.map((w) => [w.id, w]));
  return {
    server,
    upsertCheckin: jest.fn(async (draft: CheckinDraft): Promise<DailyCheckin> => ({ ...draft, userId: ME })),
    getWorkout: jest.fn(async (id: string): Promise<Workout | null> => server.get(id) ?? null),
    completeWorkout: jest.fn(async (id: string, data: CompletedData): Promise<Workout> => {
      const current = server.get(id);
      if (!current) throw new RepositoryError('not_found', 'Ese entreno ya no existe.');
      const done: Workout = { ...current, status: 'completed', completed: { source: 'manual', ...data } };
      server.set(id, done);
      return done;
    }),
  } satisfies FlushRepo & { server: Map<string, Workout> };
}

beforeEach(async () => {
  resetOfflineQueueForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('offline queue (persisted per account)', () => {
  test('one item per key: a newer check-in of the same day replaces the older one', async () => {
    await enqueueOffline(ME, checkinItem());
    await enqueueOffline(ME, checkinItem({ ...DRAFT, fatigue: 4 }));
    await enqueueOffline(ME, completeItem('w1'));
    const items = getOfflineItems(ME);
    expect(items.map((i) => i.key)).toEqual(['checkin:2026-11-26', 'complete:w1']);
    expect(items[0]?.kind === 'checkin' && items[0].draft.fatigue).toBe(4);
  });

  test('stored on the device under the account and read back after a restart', async () => {
    await enqueueOffline(ME, completeItem('w1'));
    await offlineWritesSettled();
    expect(parseOfflineItems(await AsyncStorage.getItem(storageKeyFor(ME)))).toHaveLength(1);
    resetOfflineQueueForTests();
    expect(getOfflineItems(ME)).toHaveLength(0);
    await loadOfflineQueue(ME);
    expect(getOfflineItems(ME).map((i) => i.key)).toEqual(['complete:w1']);
  });

  test("another account on the same phone never sees (or sends) the first one's items", async () => {
    await enqueueOffline(ME, checkinItem());
    await loadOfflineQueue(OTHER);
    expect(getOfflineItems(OTHER)).toHaveLength(0);
    expect(getOfflineItems(ME)).toHaveLength(0);
    await loadOfflineQueue(ME);
    expect(getOfflineItems(ME)).toHaveLength(1);
  });

  test('removing a key, and malformed storage is ignored', async () => {
    await enqueueOffline(ME, completeItem('w1'));
    await removeOfflineKey(ME, completeKey('w1'));
    expect(getOfflineItems(ME)).toHaveLength(0);
    await offlineWritesSettled();
    expect(await AsyncStorage.getItem(storageKeyFor(ME))).toBeNull();
    expect(parseOfflineItems('{oops')).toEqual([]);
    expect(parseOfflineItems(JSON.stringify([{ kind: 'complete', id: 'x' }, 3]))).toEqual([]);
  });
});

describe('saveOrQueue', () => {
  test('with connection it saves and drops an older copy waiting for the same day', async () => {
    await enqueueOffline(ME, checkinItem());
    const send = jest.fn(async () => 'saved');
    const outcome = await saveOrQueue({ userId: ME, item: checkinItem(), send, optimistic: () => 'optimistic' });
    expect(outcome).toEqual({ result: 'saved', queued: false });
    expect(getOfflineItems(ME)).toHaveLength(0);
  });

  test('without connection the change waits on the phone and the optimistic result comes back', async () => {
    const send = jest.fn(async (): Promise<string> => {
      throw offline();
    });
    const outcome = await saveOrQueue({ userId: ME, item: checkinItem(), send, optimistic: () => 'optimistic' });
    expect(outcome).toEqual({ result: 'optimistic', queued: true });
    expect(getOfflineItems(ME).map((i) => i.key)).toEqual(['checkin:2026-11-26']);
  });

  test('a refusal (validation, not found…) is thrown as before and nothing is queued', async () => {
    const send = jest.fn(async (): Promise<string> => {
      throw new RepositoryError('validation', 'Algún dato no es válido.');
    });
    await expect(saveOrQueue({ userId: ME, item: checkinItem(), send, optimistic: () => 'x' })).rejects.toMatchObject({ code: 'validation' });
    expect(getOfflineItems(ME)).toHaveLength(0);
  });

  test('when onlineManager already knows there is no connection, the request is not even tried', async () => {
    const send = jest.fn(async () => 'saved');
    const outcome = await saveOrQueue({ userId: ME, item: checkinItem(), send, optimistic: () => 'optimistic', isOnline: () => false });
    expect(outcome.queued).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  test('a request that hangs (weak signal) is kept on the phone; if it lands later, the copy goes away', async () => {
    let land: (value: string) => void = () => undefined;
    const send = jest.fn(() => new Promise<string>((resolve) => (land = resolve)));
    const outcome = await saveOrQueue({ userId: ME, item: completeItem('w1'), send, optimistic: () => 'optimistic', timeoutMs: 5 });
    expect(outcome.queued).toBe(true);
    expect(getOfflineItems(ME)).toHaveLength(1);
    land('saved');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getOfflineItems(ME)).toHaveLength(0);
  });

  test('nothing to show while waiting (no optimistic base): the error is thrown, not hidden', async () => {
    const send = jest.fn(async (): Promise<string> => {
      throw offline();
    });
    await expect(saveOrQueue({ userId: ME, item: completeItem('w1'), send, optimistic: () => null })).rejects.toMatchObject({ code: 'network' });
    expect(getOfflineItems(ME)).toHaveLength(0);
  });
});

describe('completionToSend (a «Hecho» sent twice is safe)', () => {
  const planned = makeWorkout({ id: 'w1', sport: 'run', status: 'planned' });

  test('a planned session gets the queued «Hecho»', () => {
    expect(completionToSend(planned, DONE)).toEqual(DONE);
  });

  test('deleted meanwhile: nothing to send', () => {
    expect(completionToSend(null, DONE)).toBeNull();
  });

  test('this «Hecho» (or a newer one) already landed: nothing to send', () => {
    expect(completionToSend({ ...planned, status: 'completed', completed: DONE }, DONE)).toBeNull();
    const newer = { ...DONE, rpe: 6, completedAt: '2026-11-26T09:00:00.000Z' };
    expect(completionToSend({ ...planned, status: 'completed', completed: newer }, DONE)).toBeNull();
    const older = { ...DONE, completedAt: '2026-11-26T06:00:00.000Z' };
    expect(completionToSend({ ...planned, status: 'completed', completed: older }, DONE)).toEqual(DONE);
  });

  test('the watch got there first: its numbers stay, RPE, sensations and notes are added', () => {
    const watch: CompletedData = { durationMin: 52, avgHr: 141, distanceM: 10200, source: 'garmin', completedAt: '2026-11-26T08:00:00.000Z' };
    const queued = { ...DONE, notes: 'Piernas pesadas' };
    expect(completionToSend({ ...planned, status: 'completed', completed: watch }, queued)).toEqual({
      ...watch,
      rpe: 4,
      feel: 4,
      notes: 'Piernas pesadas',
    });
    const merged: CompletedData = { ...watch, rpe: 4, feel: 4, notes: 'Piernas pesadas' };
    expect(completionToSend({ ...planned, status: 'completed', completed: merged }, queued)).toBeNull();
  });
});

describe('flushOfflineQueue', () => {
  test('sends everything in order and empties the queue', async () => {
    const repo = fakeRepo([makeWorkout({ id: 'w1', sport: 'run' })]);
    await enqueueOffline(ME, checkinItem());
    await enqueueOffline(ME, completeItem('w1'));
    const sent: string[] = [];
    const result = await flushOfflineQueue({ repo, userId: ME, onSent: (item) => void sent.push(item.key) });
    expect(result).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(sent).toEqual(['checkin:2026-11-26', 'complete:w1']);
    expect(repo.upsertCheckin).toHaveBeenCalledWith(DRAFT);
    expect(repo.server.get('w1')?.status).toBe('completed');
    expect(getOfflineItems(ME)).toHaveLength(0);
  });

  test('still offline: stops at the first item and keeps everything, in order', async () => {
    const repo = fakeRepo([makeWorkout({ id: 'w1' })]);
    repo.upsertCheckin.mockRejectedValueOnce(offline());
    await enqueueOffline(ME, checkinItem());
    await enqueueOffline(ME, completeItem('w1'));
    const result = await flushOfflineQueue({ repo, userId: ME });
    expect(result).toEqual({ sent: 0, dropped: 0, remaining: 2 });
    expect(repo.getWorkout).not.toHaveBeenCalled();
    expect(getOfflineItems(ME).map((i) => i.key)).toEqual(['checkin:2026-11-26', 'complete:w1']);
  });

  test('a session deleted meanwhile is dropped without sending; a refused item too', async () => {
    const repo = fakeRepo([makeWorkout({ id: 'w2' })]);
    repo.completeWorkout.mockRejectedValueOnce(new RepositoryError('validation', 'Algún dato no es válido.'));
    await enqueueOffline(ME, completeItem('gone'));
    await enqueueOffline(ME, completeItem('w2'));
    const result = await flushOfflineQueue({ repo, userId: ME });
    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    expect(repo.completeWorkout).toHaveBeenCalledTimes(1);
    expect(getOfflineItems(ME)).toHaveLength(0);
  });

  test('sending the same «Hecho» twice (the first answer got lost) writes it once', async () => {
    const repo = fakeRepo([makeWorkout({ id: 'w1' })]);
    await repo.completeWorkout('w1', DONE);
    repo.completeWorkout.mockClear();
    await enqueueOffline(ME, completeItem('w1'));
    const onSent = jest.fn<(item: OfflineItem, value: SentValue) => void>();
    await flushOfflineQueue({ repo, userId: ME, onSent });
    expect(repo.completeWorkout).not.toHaveBeenCalled();
    // The screens still get the session as it is on the server.
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ key: 'complete:w1' }), { kind: 'complete', workout: repo.server.get('w1') ?? null });
  });

  test('one flush at a time', async () => {
    const repo = fakeRepo();
    await enqueueOffline(ME, checkinItem());
    const [a, b] = await Promise.all([flushOfflineQueue({ repo, userId: ME }), flushOfflineQueue({ repo, userId: ME })]);
    expect(a).toBe(b);
    expect(repo.upsertCheckin).toHaveBeenCalledTimes(1);
  });
});
