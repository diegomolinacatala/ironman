/**
 * «Hecho» and the check-in without connection through the real query hooks: the
 * screens keep the optimistic state (also across refetches), and the bridge sends
 * the changes when the connection comes back — foreground, onlineManager, the
 * retry timer or «Reintentar». The demo repository never fails, so this fake one
 * goes offline on demand.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import type { CheckinDraft, CompletedData, DailyCheckin, Workout } from '@/domain/types';
import { makeWorkout } from '@/domain/__tests__/fixtures';

import { AuthContext, RepositoryContext } from '../context';
import { getOfflineItems, resetOfflineQueueForTests } from '../offline/offlineQueue';
import { OfflineSyncBridge, requestOfflineFlush } from '../offline/useOfflineSync';
import { useCheckins, useCompleteWorkout, useResetWorkout, useUpsertCheckin, useWorkout, useWorkouts } from '../queries';
import { RepositoryError, type Repository } from '../repository';

const ME = 'me';
const DAY = '2026-11-26';
const RANGE = { from: DAY, to: DAY };
const DONE: CompletedData = { durationMin: 50, rpe: 4, feel: 4, source: 'manual', completedAt: '2026-11-26T07:30:00.000Z' };
const DRAFT: CheckinDraft = { date: DAY, sleepQuality: 4, sleepHours: 7, fatigue: 2, soreness: 2, stress: 2, motivation: 4, habits: {}, notes: null };
/** Long enough that only the test decides when to retry, unless it says otherwise. */
const SLOW_RETRY: readonly number[] = [60_000];
const FAST_RETRY: readonly number[] = [20];

const offlineError = () => new RepositoryError('network', 'Sin conexión. Revisa tu internet e inténtalo de nuevo.');

function fakeRepo() {
  const state = { online: true, workouts: [makeWorkout({ id: 'w1', date: DAY, title: 'Rodaje' })], checkins: [] as DailyCheckin[] };
  const guard = () => {
    if (!state.online) throw offlineError();
  };
  const repo = {
    mode: 'supabase',
    auth: {},
    subscribe: () => () => undefined,
    listWorkouts: jest.fn(async () => {
      guard();
      return state.workouts;
    }),
    getWorkout: jest.fn(async (id: string) => {
      guard();
      return state.workouts.find((w) => w.id === id) ?? null;
    }),
    completeWorkout: jest.fn(async (id: string, data: CompletedData) => {
      guard();
      const done: Workout = { ...(state.workouts.find((w) => w.id === id) as Workout), status: 'completed', completed: data };
      state.workouts = state.workouts.map((w) => (w.id === id ? done : w));
      return done;
    }),
    resetWorkout: jest.fn(async (id: string) => {
      guard();
      return state.workouts.find((w) => w.id === id) as Workout;
    }),
    listCheckins: jest.fn(async () => {
      guard();
      return state.checkins;
    }),
    upsertCheckin: jest.fn(async (draft: CheckinDraft) => {
      guard();
      const saved: DailyCheckin = { ...draft, userId: ME };
      state.checkins = [saved];
      return saved;
    }),
  };
  return { state, repo };
}

let fake = fakeRepo();

function wrapperWith(retryDelaysMs: readonly number[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <RepositoryContext.Provider value={fake.repo as unknown as Repository}>
        <AuthContext.Provider value={{ session: { userId: ME, email: null }, isLoading: false }}>
          <QueryClientProvider client={client}>
            <OfflineSyncBridge userId={ME} retryDelaysMs={retryDelaysMs} />
            {children}
          </QueryClientProvider>
        </AuthContext.Provider>
      </RepositoryContext.Provider>
    );
  };
}

function useDay() {
  return {
    workouts: useWorkouts(RANGE),
    workout: useWorkout('w1'),
    checkins: useCheckins(RANGE),
    complete: useCompleteWorkout(),
    reset: useResetWorkout(),
    checkin: useUpsertCheckin(),
  };
}

async function renderDay(retryDelaysMs: readonly number[] = SLOW_RETRY) {
  const view = await renderHook(() => useDay(), { wrapper: wrapperWith(retryDelaysMs) });
  await waitFor(() => expect(view.result.current.workouts.data).toHaveLength(1));
  await waitFor(() => expect(view.result.current.checkins.data).toEqual([]));
  return view;
}

/** The listener the bridge gave AppState (react-native's jest mock records it). */
function foreground(): void {
  const calls = (AppState.addEventListener as unknown as jest.Mock<(type: string, cb: (state: string) => void) => unknown>).mock.calls;
  calls.filter(([type]) => type === 'change').forEach(([, cb]) => cb('active'));
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetOfflineQueueForTests();
  await AsyncStorage.clear();
  fake = fakeRepo();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('«Hecho» without connection', () => {
  test('resolves as done, the session shows done everywhere, and it waits on the phone', async () => {
    const { result } = await renderDay();
    fake.state.online = false;
    const base = result.current.workouts.data?.[0] as Workout;
    let done: Workout | undefined;
    await act(async () => {
      done = await result.current.complete.mutateAsync({ id: 'w1', data: DONE, workout: base });
    });
    expect(done).toMatchObject({ id: 'w1', status: 'completed', completed: { rpe: 4, feel: 4 } });
    expect(result.current.workouts.data?.[0]?.status).toBe('completed');
    expect(result.current.workout.data?.status).toBe('completed');
    expect(getOfflineItems(ME).map((i) => i.key)).toEqual(['complete:w1']);
    expect(result.current.complete.error).toBeNull();
  });

  test('the optimistic state survives a refetch while still offline', async () => {
    const { result } = await renderDay();
    fake.state.online = false;
    await act(async () => {
      await result.current.complete.mutateAsync({ id: 'w1', data: DONE });
    });
    await act(async () => {
      await result.current.workouts.refetch();
    });
    expect(result.current.workouts.data?.[0]?.status).toBe('completed');
  });

  test('back in the foreground with connection: sent once, and the screens keep the server copy', async () => {
    const { result } = await renderDay();
    fake.state.online = false;
    await act(async () => {
      await result.current.complete.mutateAsync({ id: 'w1', data: DONE });
    });
    fake.state.online = true;
    await act(async () => foreground());
    await waitFor(() => expect(getOfflineItems(ME)).toHaveLength(0));
    expect(fake.repo.completeWorkout).toHaveBeenCalledTimes(2);
    expect(fake.repo.completeWorkout).toHaveBeenLastCalledWith('w1', DONE);
    expect(fake.state.workouts[0]?.status).toBe('completed');
    expect(result.current.workouts.data?.[0]?.status).toBe('completed');
  });

  test('«Reabrir» undoes a «Hecho» still waiting on the phone', async () => {
    const { result } = await renderDay();
    fake.state.online = false;
    await act(async () => {
      await result.current.complete.mutateAsync({ id: 'w1', data: DONE });
    });
    await act(async () => {
      await result.current.reset.mutateAsync('w1').catch(() => undefined);
    });
    expect(getOfflineItems(ME)).toHaveLength(0);
    expect(result.current.workouts.data?.[0]?.status).toBe('planned');
  });

  test('the retry timer sends it on its own once the connection is back', async () => {
    const { result } = await renderDay(FAST_RETRY);
    fake.state.online = false;
    await act(async () => {
      await result.current.complete.mutateAsync({ id: 'w1', data: DONE });
    });
    // A retry while still offline keeps it…
    await waitFor(() => expect(fake.repo.getWorkout.mock.calls.length).toBeGreaterThan(0));
    expect(getOfflineItems(ME)).toHaveLength(1);
    // …and the next one, with connection, sends it.
    fake.state.online = true;
    await waitFor(() => expect(getOfflineItems(ME)).toHaveLength(0));
    expect(fake.state.workouts[0]?.status).toBe('completed');
  });
});

describe('check-in without connection', () => {
  test('resolves as saved, counts as done today, and «Reintentar» sends it', async () => {
    const { result } = await renderDay();
    fake.state.online = false;
    let saved: DailyCheckin | undefined;
    await act(async () => {
      saved = await result.current.checkin.mutateAsync(DRAFT);
    });
    expect(saved).toEqual({ ...DRAFT, userId: ME });
    expect(result.current.checkins.data).toEqual([{ ...DRAFT, userId: ME }]);
    expect(getOfflineItems(ME).map((i) => i.key)).toEqual(['checkin:2026-11-26']);

    fake.state.online = true;
    await act(async () => requestOfflineFlush());
    await waitFor(() => expect(getOfflineItems(ME)).toHaveLength(0));
    expect(fake.repo.upsertCheckin).toHaveBeenLastCalledWith(DRAFT);
    expect(fake.state.checkins).toEqual([{ ...DRAFT, userId: ME }]);
    expect(result.current.checkins.data).toEqual([{ ...DRAFT, userId: ME }]);
  });

  test('when onlineManager says offline (web), it is not even tried; back online, it is sent', async () => {
    const { result } = await renderDay();
    fake.state.online = false;
    await act(async () => onlineManager.setOnline(false));
    await act(async () => {
      await result.current.checkin.mutateAsync(DRAFT);
    });
    expect(fake.repo.upsertCheckin).not.toHaveBeenCalled();
    expect(getOfflineItems(ME)).toHaveLength(1);
    fake.state.online = true;
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(getOfflineItems(ME)).toHaveLength(0));
    expect(fake.repo.upsertCheckin).toHaveBeenCalledTimes(1);
  });

  test('with connection nothing changes: saved and refetched, nothing kept', async () => {
    const { result } = await renderDay();
    await act(async () => {
      await result.current.checkin.mutateAsync(DRAFT);
    });
    expect(getOfflineItems(ME)).toHaveLength(0);
    await waitFor(() => expect(fake.repo.listCheckins.mock.calls.length).toBeGreaterThan(1));
  });

  test('a refusal is still an error (nothing kept)', async () => {
    const { result } = await renderDay();
    fake.repo.upsertCheckin.mockRejectedValueOnce(new RepositoryError('validation', 'Algún dato no es válido.'));
    await act(async () => {
      await expect(result.current.checkin.mutateAsync(DRAFT)).rejects.toMatchObject({ code: 'validation' });
    });
    expect(getOfflineItems(ME)).toHaveLength(0);
  });
});
