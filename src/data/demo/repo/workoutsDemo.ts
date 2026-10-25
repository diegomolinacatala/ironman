import { applyPlanChanges as applyChanges } from '@/domain/changes';
import type { ApplyResult, CompletedData, DateRange, PlanChange, UUID, Workout, WorkoutDraft, WorkoutPatch } from '@/domain/types';

import type { Repository } from '../../repository';
import type { DemoClock, DemoDb } from '../db';
import { feedForCompletion } from '../events';
import { assertWorkoutDraft } from '../validation';
import { RESET_PATCH, completionPatch, proposalStatusAfterApply, skipPatch } from '../workoutOps';
import { byDateThenTime, inRange, notFound, requireMe, type DemoDeps } from './common';

type WorkoutMethods = Pick<
  Repository,
  | 'listWorkouts'
  | 'getWorkout'
  | 'createWorkout'
  | 'updateWorkout'
  | 'deleteWorkout'
  | 'completeWorkout'
  | 'skipWorkout'
  | 'resetWorkout'
  | 'applyPlanChanges'
>;

const NOT_FOUND = 'Ese entreno ya no existe.';

export function draftToWorkout(draft: WorkoutDraft, userId: UUID, clock: DemoClock): Workout {
  return {
    id: clock.newId(),
    userId,
    date: draft.date,
    startTime: draft.startTime ?? null,
    sport: draft.sport,
    title: draft.title.trim(),
    description: draft.description ?? null,
    durationMin: Math.round(draft.durationMin),
    distanceM: draft.distanceM ?? null,
    intensity: draft.intensity,
    tss: draft.tss ?? null,
    steps: draft.steps ?? [],
    status: 'planned',
    completed: null,
    source: draft.source ?? 'manual',
    isKey: draft.isKey ?? false,
    jointSessionId: null,
    externalId: draft.externalId ?? null,
    createdAt: clock.now,
    updatedAt: clock.now,
  };
}

/** Pure patch of one of `me`'s workouts (+ feed event when it becomes completed). */
export function patchWorkout(db: DemoDb, me: UUID, id: UUID, patch: WorkoutPatch, clock: DemoClock): { db: DemoDb; result: Workout } {
  const current = db.workouts.find((w) => w.id === id && w.userId === me);
  if (!current) throw notFound(NOT_FOUND);
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as WorkoutPatch;
  const updated: Workout = {
    ...current,
    ...defined,
    title: defined.title?.trim() ?? current.title,
    durationMin: defined.durationMin === undefined ? current.durationMin : Math.round(defined.durationMin),
    updatedAt: clock.now,
  };
  const next = { ...db, workouts: db.workouts.map((w) => (w.id === id ? updated : w)) };
  const becameCompleted = current.status !== 'completed' && updated.status === 'completed';
  return { db: becameCompleted ? feedForCompletion(next, updated, clock) : next, result: updated };
}

function unlinkParticipants(db: DemoDb, workoutId: UUID): DemoDb {
  return {
    ...db,
    jointSessions: db.jointSessions.map((s) => ({
      ...s,
      participants: s.participants.map((p) => (p.workoutId === workoutId ? { ...p, workoutId: null } : p)),
    })),
  };
}

export function workoutsDemo({ store }: DemoDeps): WorkoutMethods {
  async function updateWorkout(id: UUID, patch: WorkoutPatch): Promise<Workout> {
    assertWorkoutDraft(patch, true);
    const me = await requireMe(store);
    return store.update((db, clock) => patchWorkout(db, me, id, patch, clock));
  }

  async function applyPlanChanges(changes: PlanChange[], proposalId?: UUID): Promise<ApplyResult> {
    const me = await requireMe(store);
    return store.update((db, clock) => {
      const mine = db.workouts.filter((w) => w.userId === me);
      const result = applyChanges(mine, changes, { userId: me, now: clock.now, newId: clock.newId });
      const proposal = proposalId ? db.proposals.find((p) => p.id === proposalId && p.userId === me) : undefined;
      const status = proposal
        ? proposalStatusAfterApply(result.applied, result.failed.length, proposal.changes.length)
        : null;
      const proposals = status
        ? db.proposals.map((p) => (p.id === proposalId && p.userId === me ? { ...p, status } : p))
        : db.proposals;
      const workouts = [...db.workouts.filter((w) => w.userId !== me), ...result.workouts];
      // joint_session_participants.workout_id is `on delete set null` in SQL.
      const kept = new Set(result.workouts.map((w) => w.id));
      const unlinked = mine.filter((w) => !kept.has(w.id)).reduce((acc, w) => unlinkParticipants(acc, w.id), { ...db, workouts, proposals });
      return { db: unlinked, result };
    });
  }

  return {
    async listWorkouts(range: DateRange) {
      const me = await requireMe(store);
      const db = await store.read();
      return db.workouts.filter((w) => w.userId === me && inRange(w.date, range)).sort(byDateThenTime);
    },
    async getWorkout(id: UUID) {
      const me = await requireMe(store);
      const db = await store.read();
      return db.workouts.find((w) => w.id === id && w.userId === me) ?? null;
    },
    async createWorkout(draft: WorkoutDraft) {
      assertWorkoutDraft(draft, false);
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const workout = draftToWorkout(draft, me, clock);
        return { db: { ...db, workouts: [...db.workouts, workout] }, result: workout };
      });
    },
    updateWorkout,
    async deleteWorkout(id: UUID) {
      const me = await requireMe(store);
      await store.update((db) => {
        if (!db.workouts.some((w) => w.id === id && w.userId === me)) throw notFound(NOT_FOUND);
        const next = { ...db, workouts: db.workouts.filter((w) => w.id !== id) };
        return { db: unlinkParticipants(next, id), result: undefined };
      });
    },
    async completeWorkout(id: UUID, data: CompletedData) {
      return updateWorkout(id, completionPatch(data, store.clock().now));
    },
    skipWorkout: (id: UUID, reason?: string) => updateWorkout(id, skipPatch(reason)),
    resetWorkout: (id: UUID) => updateWorkout(id, RESET_PATCH),
    applyPlanChanges,
  };
}
