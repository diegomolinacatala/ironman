/// <reference types="jest" />
import { RepositoryError } from '../repository';
import { DEMO_USERS } from '../demo/ids';
import { resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const NEXT_WEEK = { from: '2026-10-26', to: '2026-11-01' };

beforeEach(resetStorage);

describe('demo workouts', () => {
  it('creates, completes, skips and resets a workout', async () => {
    const repo = await signedInRepo();
    const created = await repo.createWorkout({
      date: '2026-10-27',
      startTime: '07:00',
      sport: 'swim',
      title: '  Nado técnico ',
      durationMin: 45,
      intensity: 'endurance',
    });
    expect(created).toMatchObject({ userId: DEMO_USERS.diego, title: 'Nado técnico', status: 'planned', source: 'manual' });
    expect((await repo.listWorkouts({ from: '2026-10-27', to: '2026-10-27' })).map((w) => w.id)).toContain(created.id);

    const feedBefore = (await repo.listFeed()).length;
    const done = await repo.completeWorkout(created.id, { durationMin: 47, rpe: 6 });
    expect(done.status).toBe('completed');
    expect(done.completed).toMatchObject({ durationMin: 47, rpe: 6, source: 'manual' });
    expect(done.completed?.completedAt).toBeTruthy();
    const feed = await repo.listFeed();
    expect(feed.length).toBe(feedBefore + 1);
    expect(feed[0]).toMatchObject({ type: 'workout_completed', payload: expect.objectContaining({ title: 'Nado técnico' }) });

    const skipped = await repo.skipWorkout(created.id, 'Me dolía la cabeza');
    expect(skipped).toMatchObject({ status: 'skipped', completed: { notes: 'Me dolía la cabeza' } });

    const reset = await repo.resetWorkout(created.id);
    expect(reset).toMatchObject({ status: 'planned', completed: null });

    await repo.deleteWorkout(created.id);
    expect(await repo.getWorkout(created.id)).toBeNull();
    await repo.store.dispose();
  });

  it('validates input with Spanish messages', async () => {
    const repo = await signedInRepo();
    await expect(
      repo.createWorkout({ date: 'mañana', sport: 'run', title: 'x', durationMin: 30, intensity: 'endurance' }),
    ).rejects.toMatchObject({ code: 'validation', message: 'Fecha inválida' });
    const [w] = await repo.listWorkouts(NEXT_WEEK);
    await expect(repo.completeWorkout(w?.id ?? '', { rpe: 14 })).rejects.toBeInstanceOf(RepositoryError);
    await expect(repo.updateWorkout('missing', { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await repo.store.dispose();
  });

  it('applies a proposal and marks it applied', async () => {
    const repo = await signedInRepo();
    const [proposal] = await repo.listProposals('pending');
    if (!proposal) throw new Error('seed proposal missing');
    const result = await repo.applyPlanChanges(proposal.changes, proposal.id);
    expect(result.failed).toEqual([]);
    expect(result.applied).toBe(proposal.changes.length);
    expect((await repo.getProposal(proposal.id))?.status).toBe('applied');

    const week = await repo.listWorkouts(NEXT_WEEK);
    proposal.changes.forEach((change) => {
      if (change.op === 'move') {
        expect(week.find((w) => w.id === change.workoutId)).toMatchObject({ date: change.toDate, startTime: change.toStartTime });
      }
      if (change.op === 'update') {
        expect(week.find((w) => w.id === change.workoutId)).toMatchObject(change.patch);
      }
      if (change.op === 'add') {
        expect(week.some((w) => w.title === change.workout.title && w.date === change.workout.date)).toBe(true);
      }
    });
    await repo.store.dispose();
  });

  it('reports failed changes and marks the proposal partially applied', async () => {
    const repo = await signedInRepo();
    const proposal = await repo.createProposal({
      kind: 'replan',
      source: 'rules',
      weekStart: NEXT_WEEK.from,
      summary: 'Prueba',
      changes: [
        { op: 'delete', workoutId: 'does-not-exist', reason: 'x' },
        { op: 'add', workout: { date: '2026-10-28', sport: 'mobility', title: 'Movilidad', durationMin: 15, intensity: 'recovery' }, reason: 'y' },
      ],
    });
    const result = await repo.applyPlanChanges(proposal.changes, proposal.id);
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([{ index: 0, error: 'Entreno no encontrado' }]);
    expect((await repo.getProposal(proposal.id))?.status).toBe('partially_applied');
    await repo.store.dispose();
  });

  it('deleting a quedada workout through a proposal clears the participant link (on delete set null)', async () => {
    const repo = await signedInRepo();
    const ride = (await repo.listJointSessions(NEXT_WEEK)).find((s) => s.status === 'confirmed' && s.organizerId === DEMO_USERS.diego);
    const mine = ride?.participants.find((p) => p.userId === DEMO_USERS.diego)?.workoutId;
    if (!ride || !mine) throw new Error('seed ride missing');
    const result = await repo.applyPlanChanges([{ op: 'delete', workoutId: mine, reason: 'Lesión roja: descanso' }]);
    expect(result).toMatchObject({ applied: 1, failed: [] });
    const after = await repo.getJointSession(ride.id);
    expect(after?.participants.find((p) => p.userId === DEMO_USERS.diego)?.workoutId).toBeNull();
    expect(after?.participants.find((p) => p.userId === DEMO_USERS.alex)?.workoutId).not.toBeNull();
    await repo.store.dispose();
  });

  it('only exposes my own workouts', async () => {
    const repo = await signedInRepo();
    const all = await repo.listWorkouts({ from: '2026-09-01', to: '2026-12-31' });
    expect(all.every((w) => w.userId === DEMO_USERS.diego)).toBe(true);
    const db = await repo.store.read();
    const alexWorkout = db.workouts.find((w) => w.userId === DEMO_USERS.alex);
    expect(await repo.getWorkout(alexWorkout?.id ?? '')).toBeNull();
    await expect(repo.deleteWorkout(alexWorkout?.id ?? '')).rejects.toMatchObject({ code: 'not_found' });
    await repo.store.dispose();
  });
});
