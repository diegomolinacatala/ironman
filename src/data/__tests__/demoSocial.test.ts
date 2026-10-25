/// <reference types="jest" />
import type { CalendarVisibility } from '@/domain/types';

import { DEMO_USERS } from '../demo/ids';
import type { DemoRepository } from '../demo/DemoRepository';
import { resetStorage, signedInRepo, waitForTopic } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const NEXT_WEEK = { from: '2026-10-26', to: '2026-11-01' };

beforeEach(resetStorage);

async function setAlexVisibility(repo: DemoRepository, visibility: CalendarVisibility): Promise<void> {
  await repo.store.update((db) => ({
    db: { ...db, profiles: db.profiles.map((p) => (p.id === DEMO_USERS.alex ? { ...p, visibility } : p)) },
    result: undefined,
  }));
}

describe('demo friend week masking', () => {
  it('full shows titles; busy block titles are never exposed', async () => {
    const repo = await signedInRepo();
    const items = await repo.getFriendWeek(DEMO_USERS.alex, NEXT_WEEK);
    const workouts = items.filter((i) => i.kind === 'workout');
    expect(workouts.length).toBeGreaterThan(5);
    expect(workouts.every((w) => w.title && w.sport && w.id)).toBe(true);
    const busy = items.filter((i) => i.kind === 'busy');
    expect(busy.length).toBe(5);
    expect(busy.every((b) => b.title === null && b.id === null)).toBe(true);
    expect(items.some((i) => i.kind === 'event' && i.title === 'Fútbol 7 con el trabajo')).toBe(true);
    await repo.store.dispose();
  });

  it('summary hides titles, busy only returns intervals', async () => {
    const repo = await signedInRepo();
    await setAlexVisibility(repo, 'summary');
    const summary = await repo.getFriendWeek(DEMO_USERS.alex, NEXT_WEEK);
    expect(summary.some((i) => i.kind === 'workout')).toBe(true);
    expect(summary.every((i) => i.title === null)).toBe(true);

    await setAlexVisibility(repo, 'busy');
    const busy = await repo.getFriendWeek(DEMO_USERS.alex, NEXT_WEEK);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every((i) => i.kind === 'busy' && i.sport === null && i.title === null && i.id === null)).toBe(true);
    await repo.store.dispose();
  });

  it('rejects non-friends and ranges over 31 days', async () => {
    const repo = await signedInRepo();
    await expect(repo.getFriendWeek(DEMO_USERS.marcos, NEXT_WEEK)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(repo.getFriendWeek(DEMO_USERS.alex, { from: '2026-10-01', to: '2026-11-30' })).rejects.toMatchObject({
      code: 'validation',
    });
    await repo.store.dispose();
  });
});

describe('demo quedadas', () => {
  it('accepting an invite creates my linked workout and confirms the session', async () => {
    const repo = await signedInRepo();
    const sessions = await repo.listJointSessions(NEXT_WEEK);
    const invite = sessions.find((s) => s.status === 'proposed');
    if (!invite) throw new Error('seed invite missing');
    await repo.respondJointSession(invite.id, true);
    const after = await repo.getJointSession(invite.id);
    expect(after?.status).toBe('confirmed');
    const me = after?.participants.find((p) => p.userId === DEMO_USERS.diego);
    expect(me?.status).toBe('accepted');
    const workout = await repo.getWorkout(me?.workoutId ?? '');
    expect(workout).toMatchObject({ jointSessionId: invite.id, source: 'joint', date: invite.date, startTime: invite.startTime });
    const db = await repo.store.read();
    expect(db.notifications.some((n) => n.userId === DEMO_USERS.alex && n.type === 'joint_response')).toBe(true);
    await repo.store.dispose();
  });

  it('proposing links my workout; simulated Álex accepts and realtime fires; cancel cleans up', async () => {
    const repo = await signedInRepo();
    const [base] = (await repo.listWorkouts(NEXT_WEEK)).filter((w) => w.sport === 'swim');
    const session = await repo.proposeJointSession({
      sport: 'swim',
      date: base?.date ?? '2026-10-27',
      startTime: '07:00',
      durationMin: 60,
      intensity: 'endurance',
      title: 'Piscina juntos',
      inviteeIds: [DEMO_USERS.alex],
      fromWorkoutId: base?.id ?? null,
    });
    expect(session.status).toBe('proposed');
    expect(session.participants.find((p) => p.userId === DEMO_USERS.diego)?.workoutId).toBe(base?.id);
    expect((await repo.getWorkout(base?.id ?? ''))?.jointSessionId).toBe(session.id);

    await waitForTopic(repo, 'joint_sessions');
    const confirmed = await repo.getJointSession(session.id);
    expect(confirmed?.status).toBe('confirmed');
    const alex = confirmed?.participants.find((p) => p.userId === DEMO_USERS.alex);
    expect(alex?.status).toBe('accepted');
    const db = await repo.store.read();
    expect(db.workouts.find((w) => w.id === alex?.workoutId)).toMatchObject({ userId: DEMO_USERS.alex, jointSessionId: session.id });
    expect((await repo.listNotifications()).some((n) => n.type === 'joint_response' && n.title.includes('Piscina juntos'))).toBe(true);

    await repo.cancelJointSession(session.id);
    expect((await repo.getJointSession(session.id))?.status).toBe('cancelled');
    expect((await repo.getWorkout(base?.id ?? ''))?.jointSessionId).toBeNull();
    const afterCancel = await repo.store.read();
    expect(afterCancel.workouts.some((w) => w.id === alex?.workoutId)).toBe(false);
    await repo.store.dispose();
  });

  it('linking an existing workout aligns it to the quedada and rejects one already in another quedada (SQL parity)', async () => {
    const repo = await signedInRepo();
    const base = await repo.createWorkout({ date: '2026-10-28', startTime: '07:00', sport: 'run', title: 'Rodaje', durationMin: 45, intensity: 'endurance' });
    const draft = { sport: 'run' as const, date: '2026-10-29', startTime: '19:00', durationMin: 45, intensity: 'endurance' as const, title: 'Rodaje juntos', inviteeIds: [DEMO_USERS.alex], fromWorkoutId: base.id };
    const session = await repo.proposeJointSession(draft);
    expect(await repo.getWorkout(base.id)).toMatchObject({ jointSessionId: session.id, date: '2026-10-29', startTime: '19:00' });
    await expect(repo.proposeJointSession({ ...draft, date: '2026-10-30' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await repo.getWorkout(base.id))?.jointSessionId).toBe(session.id);
    await repo.store.dispose();
  });

  it('cancelling unlinks every participant and every linked workout, deleting only planned ones of others', async () => {
    const repo = await signedInRepo();
    const ride = (await repo.listJointSessions(NEXT_WEEK)).find((s) => s.status === 'confirmed' && s.organizerId === DEMO_USERS.diego);
    if (!ride) throw new Error('seed ride missing');
    const alexWorkoutId = ride.participants.find((p) => p.userId === DEMO_USERS.alex)?.workoutId ?? '';
    await repo.store.update((db) => ({
      db: { ...db, workouts: db.workouts.map((w) => (w.id === alexWorkoutId ? { ...w, status: 'completed' as const } : w)) },
      result: undefined,
    }));
    await repo.cancelJointSession(ride.id);
    const db = await repo.store.read();
    expect(db.workouts.find((w) => w.id === alexWorkoutId)).toMatchObject({ status: 'completed', jointSessionId: null });
    expect(db.workouts.some((w) => w.jointSessionId === ride.id)).toBe(false);
    expect(db.jointSessions.find((s) => s.id === ride.id)?.participants.every((p) => p.workoutId === null)).toBe(true);
    await repo.store.dispose();
  });

  it('only friends can be invited', async () => {
    const repo = await signedInRepo();
    await expect(
      repo.proposeJointSession({ sport: 'run', date: '2026-10-28', durationMin: 45, intensity: 'endurance', title: 'Rodaje', inviteeIds: [DEMO_USERS.marcos] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await repo.store.dispose();
  });
});

describe('demo friends and feed', () => {
  it('accepts an incoming request and simulates acceptance of outgoing ones', async () => {
    const repo = await signedInRepo();
    const lucia = (await repo.listFriends()).find((f) => f.profile.username === 'lucia');
    await repo.respondFriendRequest(lucia?.friendshipId ?? '', true);
    expect((await repo.listFriends()).find((f) => f.profile.username === 'lucia')?.status).toBe('accepted');

    expect((await repo.searchProfiles('marc')).map((p) => p.username)).toEqual(['marcos']);
    await repo.sendFriendRequest('@marcos');
    expect((await repo.listFriends()).find((f) => f.profile.username === 'marcos')?.direction).toBe('outgoing');
    await waitForTopic(repo, 'friends');
    expect((await repo.listFriends()).find((f) => f.profile.username === 'marcos')?.status).toBe('accepted');
    await expect(repo.sendFriendRequest('alex')).rejects.toMatchObject({ code: 'conflict' });
    await expect(repo.sendFriendRequest('nadie')).rejects.toMatchObject({ code: 'not_found' });
    await repo.store.dispose();
  });

  it('toggles kudos', async () => {
    const repo = await signedInRepo();
    const item = (await repo.listFeed()).find((f) => f.actor.id === DEMO_USERS.alex && !f.hasKudoed);
    if (!item) throw new Error('no feed item');
    await repo.toggleKudos(item.id);
    const after = (await repo.listFeed()).find((f) => f.id === item.id);
    expect(after).toMatchObject({ hasKudoed: true, kudosCount: item.kudosCount + 1 });
    await repo.toggleKudos(item.id);
    expect((await repo.listFeed()).find((f) => f.id === item.id)?.hasKudoed).toBe(false);
    await repo.store.dispose();
  });
});
