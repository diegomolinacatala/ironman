import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ApplyResult, DateRange, PlanChange, ProposalStatus, Workout } from '@/domain/types';

import { buildDiffRows, isChangeApplied, previewTotals, proposalSpan, statusAfterApply } from '../proposalDiff';
import { useProposalReview } from '../useProposalReview';
import { makeProposal, makeWorkout } from './fixtures';

const mockRanges: DateRange[] = [];
let mockWorkouts: Workout[] = [];
const mockApply = jest.fn(async (_input: { changes: PlanChange[]; proposalId: string }): Promise<ApplyResult> => ({ applied: 0, failed: [], workouts: [] }));
const mockSetStatus = jest.fn(async (_input: { id: string; status: ProposalStatus }) => undefined);

jest.mock('@/data/context', () => ({ useAuth: () => ({ session: { userId: 'me' } }) }));
jest.mock('../usePrescriptionContext', () => ({ usePrescriptionContext: () => ({ thresholds: {}, raceDistance: null }) }));
jest.mock('@/ui', () => ({ haptics: { success: jest.fn(), warning: jest.fn(), tap: jest.fn() } }));
jest.mock('@/data/queries', () => ({
  useWorkouts: (range: DateRange) => {
    mockRanges.push(range);
    return { data: mockWorkouts, isLoading: false, error: null, refetch: jest.fn() };
  },
  useJointSessions: () => ({ data: [], isLoading: false, error: null }),
  useApplyPlanChanges: () => ({ mutateAsync: mockApply, isPending: false }),
  useSetProposalStatus: () => ({ mutateAsync: mockSetStatus, isPending: false }),
}));

beforeEach(() => {
  mockRanges.length = 0;
  mockWorkouts = [];
  mockApply.mockClear();
  mockSetStatus.mockClear();
});

const WEEK = '2026-10-26';
const nextWeekRun = makeWorkout({ id: 'w2', date: '2026-11-04', title: 'Rodaje semana 2' });

describe('proposalSpan (defect 8)', () => {
  test('covers 14 days from weekStart plus a week before', () => {
    expect(proposalSpan({ weekStart: WEEK, changes: [] })).toEqual({ from: '2026-10-19', to: '2026-11-08' });
  });

  test('widens to every date the changes name', () => {
    const changes: PlanChange[] = [
      { op: 'move', workoutId: 'a', toDate: '2026-11-12', reason: 'r' },
      { op: 'update', workoutId: 'b', patch: { date: '2026-10-15' }, reason: 'r' },
    ];
    expect(proposalSpan({ weekStart: WEEK, changes })).toEqual({ from: '2026-10-08', to: '2026-11-12' });
  });

  test('changes in the second week are found (not "ya no está en tu semana")', () => {
    const rows = buildDiffRows([{ op: 'delete', workoutId: 'w2', reason: 'r' }], [nextWeekRun]);
    expect(rows[0]?.missing).toBe(false);
    expect(rows[0]?.title).toBe('Rodaje semana 2');
  });
});

describe('isChangeApplied / statusAfterApply (defect 11)', () => {
  const run = makeWorkout({ id: 'run', date: '2026-10-28', startTime: '18:00', durationMin: 40, title: 'Rodaje' });

  test('detects what is already in the plan', () => {
    expect(isChangeApplied({ op: 'move', workoutId: 'run', toDate: '2026-10-28', toStartTime: '18:00', reason: 'r' }, [run])).toBe(true);
    expect(isChangeApplied({ op: 'move', workoutId: 'run', toDate: '2026-10-29', reason: 'r' }, [run])).toBe(false);
    expect(isChangeApplied({ op: 'update', workoutId: 'run', patch: { durationMin: 40, title: ' Rodaje ' }, reason: 'r' }, [run])).toBe(true);
    expect(isChangeApplied({ op: 'update', workoutId: 'run', patch: { durationMin: 30 }, reason: 'r' }, [run])).toBe(false);
    expect(isChangeApplied({ op: 'delete', workoutId: 'gone', reason: 'r' }, [run])).toBe(true);
    const add: PlanChange = { op: 'add', workout: { date: '2026-10-28', sport: run.sport, title: 'Rodaje', durationMin: 40, intensity: 'endurance' }, reason: 'r' };
    expect(isChangeApplied(add, [run])).toBe(true);
  });

  test('a retry that applies everything missing closes the proposal; otherwise it stays partial', () => {
    const base = { alreadyApplied: [true, false, false], applied: 2, failedCount: 0 };
    expect(statusAfterApply({ ...base, status: 'partially_applied', indexes: [1, 2] })).toBe('applied');
    expect(statusAfterApply({ ...base, status: 'partially_applied', indexes: [1] })).toBe('partially_applied');
    expect(statusAfterApply({ ...base, status: 'partially_applied', indexes: [1, 2], failedCount: 1 })).toBe('partially_applied');
    expect(statusAfterApply({ status: 'pending', alreadyApplied: [false, false], indexes: [0, 1], applied: 2, failedCount: 0 })).toBeNull();
    expect(statusAfterApply({ status: 'pending', alreadyApplied: [false, false], indexes: [0], applied: 1, failedCount: 0 })).toBe('partially_applied');
    expect(statusAfterApply({ ...base, status: 'partially_applied', indexes: [1, 2], applied: 0 })).toBeNull();
  });
});

describe('previewTotals (defect 12)', () => {
  test('predicts that a change into the past will be refused', () => {
    const run = makeWorkout({ id: 'run', date: '2026-10-28' });
    const p = previewTotals({
      workouts: [run],
      changes: [{ op: 'move', workoutId: 'run', toDate: '2026-10-26', reason: 'r' }],
      indexes: [0],
      weekStart: WEEK,
      today: '2026-10-27',
      userId: 'me',
    });
    expect(p.failed).toEqual([{ index: 0, error: 'La fecha ya ha pasado' }]);
  });
});

describe('useProposalReview', () => {
  test('loads every date the proposal touches (defect 8)', async () => {
    mockWorkouts = [nextWeekRun];
    const proposal = makeProposal({ weekStart: WEEK, changes: [{ op: 'delete', workoutId: 'w2', reason: 'r' }] });
    const { result } = await renderHook(() => useProposalReview(proposal));
    expect(mockRanges[0]).toEqual(proposalSpan(proposal));
    expect(result.current.rows[0]?.missing).toBe(false);
  });

  test('a partially applied proposal preselects only what is missing and closes after a full retry (defect 11)', async () => {
    const moved = makeWorkout({ id: 'a', date: '2026-10-29', title: 'Ya movido' });
    const stuck = makeWorkout({ id: 'b', date: '2026-10-28', title: 'Pendiente' });
    mockWorkouts = [moved, stuck];
    const changes: PlanChange[] = [
      { op: 'move', workoutId: 'a', toDate: '2026-10-29', reason: 'r' },
      { op: 'move', workoutId: 'b', toDate: '2026-10-30', reason: 'r' },
    ];
    const proposal = makeProposal({ weekStart: WEEK, status: 'partially_applied', changes });
    mockApply.mockResolvedValueOnce({ applied: 1, failed: [], workouts: [] });
    const { result } = await renderHook(() => useProposalReview(proposal));
    await waitFor(() => expect(result.current.selected).toEqual([false, true]));
    expect(result.current.isRetry).toBe(true);
    expect(result.current.applied).toEqual([true, false]);
    expect(result.current.selectedCount).toBe(1);
    await act(async () => {
      await result.current.apply();
    });
    expect(mockApply).toHaveBeenCalledWith({ changes: [changes[1]], proposalId: 'p1' });
    expect(mockSetStatus).toHaveBeenCalledWith({ id: 'p1', status: 'applied' });
  });
});
