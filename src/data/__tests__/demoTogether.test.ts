/// <reference types="jest" />
import { DEMO_USERS } from '../demo/ids';
import { proposeJoint } from '../demo/jointOps';
import { resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

const RANGE = { from: '2026-10-25', to: '2026-11-08' };

describe('demo Juntos v3', () => {
  it("lists a friend's open quedada and joins it (linked workout + organizer notified)", async () => {
    const repo = await signedInRepo();
    const sessionId = await repo.store.update((db, clock) => {
      const r = proposeJoint(db, DEMO_USERS.alex, {
        sport: 'run', date: '2026-10-29', startTime: '07:30', durationMin: 60, intensity: 'endurance',
        title: 'Rodaje abierto', inviteeIds: [], isOpen: true,
      }, clock);
      return { db: r.db, result: r.sessionId };
    });
    const open = await repo.listOpenJointSessions(RANGE);
    expect(open.map((s) => s.id)).toContain(sessionId);
    const notes = await repo.listNotifications();
    expect(notes.some((n) => n.type === 'joint_open' && n.title === 'Álex abre una quedada')).toBe(true);

    const joined = await repo.joinJointSession(sessionId);
    expect(joined.status).toBe('confirmed');
    const me = joined.participants.find((p) => p.userId === DEMO_USERS.diego);
    expect(me?.status).toBe('accepted');
    const db = await repo.store.read();
    expect(db.workouts.some((w) => w.id === me?.workoutId && w.jointSessionId === sessionId)).toBe(true);
    expect((await repo.listOpenJointSessions(RANGE)).some((s) => s.id === sessionId)).toBe(false);
    await repo.store.dispose();
  });

  it('edits a quedada I organise, moves every linked workout and comments on it', async () => {
    const repo = await signedInRepo();
    const [ride] = (await repo.listJointSessions({ from: '2026-10-25', to: '2026-11-15' })).filter((s) => s.organizerId === DEMO_USERS.diego);
    expect(ride).toBeDefined();
    const updated = await repo.updateJointSession(ride!.id, { startTime: '09:15', location: 'Casa de Campo' });
    expect(updated.startTime).toBe('09:15');
    expect(updated.location).toBe('Casa de Campo');
    const db = await repo.store.read();
    const linked = db.workouts.filter((w) => w.jointSessionId === ride!.id && w.status === 'planned');
    expect(linked.length).toBe(2);
    expect(linked.every((w) => w.startTime === '09:15')).toBe(true);
    expect(db.notifications.some((n) => n.userId === DEMO_USERS.alex && n.type === 'joint_updated')).toBe(true);

    const comment = await repo.addJointComment(ride!.id, '  ¿Llevo geles?  ');
    expect(comment.body).toBe('¿Llevo geles?');
    expect((await repo.listJointComments(ride!.id)).map((c) => c.body)).toEqual(['¿Llevo geles?']);
    await expect(repo.addJointComment(ride!.id, '   ')).rejects.toMatchObject({ code: 'validation' });
    await expect(repo.updateJointSession(ride!.id, { date: '2026-01-01' })).rejects.toMatchObject({ code: 'validation' });
    await repo.store.dispose();
  });

  it('posts "entrenasteis juntos" once both linked workouts are completed', async () => {
    const repo = await signedInRepo();
    const [ride] = (await repo.listJointSessions({ from: '2026-10-25', to: '2026-11-15' })).filter((s) => s.status === 'confirmed');
    const alexWorkout = ride!.participants.find((p) => p.userId === DEMO_USERS.alex)!.workoutId!;
    const myWorkout = ride!.participants.find((p) => p.userId === DEMO_USERS.diego)!.workoutId!;
    await repo.store.update((db) => ({
      db: { ...db, workouts: db.workouts.map((w) => (w.id === alexWorkout ? { ...w, status: 'completed' as const } : w)) },
      result: undefined,
    }));
    await repo.completeWorkout(myWorkout, { durationMin: 180 } as never);
    const feed = await repo.listFeed(50);
    const events = feed.filter((f) => f.type === 'joint_completed');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.participants).toEqual(['Álex', 'Diego']);
    await repo.store.dispose();
  });

  it("friends' upcoming races", async () => {
    const repo = await signedInRepo();
    const races = await repo.listFriendRaces();
    expect(races.every((r) => r.friendId !== DEMO_USERS.diego && r.date >= '2026-10-25')).toBe(true);
    await repo.store.dispose();
  });
});
