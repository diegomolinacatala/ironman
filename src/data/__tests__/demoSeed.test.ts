/// <reference types="jest" />
import { addDays, diffDays, startOfWeek } from '@/domain/dates';

import { DEMO_USERS } from '../demo/ids';
import { WEDNESDAY, resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const TODAY = '2026-10-25';
const WEEK = { from: '2026-10-19', to: '2026-10-25' };
const NEXT_WEEK = { from: '2026-10-26', to: '2026-11-01' };

beforeEach(resetStorage);

describe('demo seed (relative to today)', () => {
  it('signs in as Diego with a complete profile', async () => {
    const repo = await signedInRepo();
    const profile = await repo.getMyProfile();
    expect(profile).toMatchObject({ id: DEMO_USERS.diego, username: 'diego', displayName: 'Diego' });
    expect(profile?.availability.weeklyHoursTarget).toBe(10);
    expect(profile?.availability.restDay).toBe(0);
    expect(profile?.availability.longSessionDays).toEqual([5, 6]);
    expect(profile?.availability.windows).toEqual(
      expect.arrayContaining([
        { weekday: 1, start: '07:00', end: '08:30' },
        { weekday: 4, start: '19:00', end: '21:30' },
      ]),
    );
    // v2: the demo athlete goes through the new onboarding once (like `onboarded_at = null` in the migration).
    expect(profile?.onboardedAt).toBeNull();
    await repo.store.dispose();
  });

  it('has an A race ~24 weeks out and a B race ~10 weeks out', async () => {
    const repo = await signedInRepo();
    const races = await repo.listRaces();
    const a = races.find((r) => r.priority === 'A');
    const b = races.find((r) => r.priority === 'B');
    expect(a?.distance).toBe('half');
    expect(b?.distance).toBe('olympic');
    expect(diffDays(a?.date ?? TODAY, TODAY)).toBe(168);
    expect(diffDays(b?.date ?? TODAY, TODAY)).toBe(70);
    await repo.store.dispose();
  });

  it('has this week and next week planned, past sessions completed with RPE, one skipped', async () => {
    const repo = await signedInRepo();
    const thisWeek = await repo.listWorkouts(WEEK);
    const nextWeek = await repo.listWorkouts(NEXT_WEEK);
    expect(thisWeek.length).toBeGreaterThanOrEqual(7);
    expect(nextWeek.length).toBeGreaterThanOrEqual(7);
    const past = thisWeek.filter((w) => w.date < TODAY);
    expect(past.filter((w) => w.status === 'completed').every((w) => typeof w.completed?.rpe === 'number')).toBe(true);
    expect(past.filter((w) => w.status === 'skipped')).toHaveLength(1);
    expect(thisWeek.filter((w) => w.date === TODAY).every((w) => w.status === 'planned')).toBe(true);
    expect(nextWeek.every((w) => w.status === 'planned')).toBe(true);
    const sports = new Set([...thisWeek, ...nextWeek].map((w) => w.sport));
    expect([...sports]).toEqual(expect.arrayContaining(['swim', 'bike', 'run', 'strength']));
    const history = await repo.listWorkouts({ from: addDays(WEEK.from, -21), to: addDays(WEEK.from, -1) });
    expect(history.length).toBeGreaterThan(20);
    await repo.store.dispose();
  });

  it('has classes Mon–Fri, a pádel match this week and 28 days of wellness data', async () => {
    const repo = await signedInRepo();
    const blocks = await repo.listBusyBlocks({ from: WEEK.from, to: NEXT_WEEK.to });
    expect(blocks).toHaveLength(10);
    expect(blocks.every((b) => b.title === 'Clases del máster')).toBe(true);
    const events = await repo.listLifeEvents(WEEK);
    expect(events.some((e) => e.kind === 'padel')).toBe(true);
    const checkins = await repo.listCheckins({ from: addDays(TODAY, -40), to: TODAY });
    expect(checkins).toHaveLength(28);
    expect(checkins[checkins.length - 1]?.date).toBe(addDays(TODAY, -1));
    const metrics = await repo.listMetrics({ from: addDays(TODAY, -40), to: TODAY });
    expect(metrics).toHaveLength(28);
    expect(metrics.every((m) => (m.hrvMs ?? 0) >= 60 && (m.hrvMs ?? 0) <= 75)).toBe(true);
    expect(metrics.every((m) => (m.restingHr ?? 0) >= 48 && (m.restingHr ?? 0) <= 52)).toBe(true);
    expect(metrics.every((m) => (m.sleepDeepMin ?? 0) >= 60 && (m.sleepDeepMin ?? 0) <= 100)).toBe(true);
    expect(metrics.every((m) => (m.sleepRemMin ?? 0) >= 80 && (m.sleepRemMin ?? 0) <= 120)).toBe(true);
    expect(metrics.every((m) => (m.sleepAwakeMin ?? 0) >= 10 && (m.sleepAwakeMin ?? 0) <= 30)).toBe(true);
    const last = metrics[metrics.length - 1];
    expect(last?.date).toBe(TODAY);
    const minutes = (Date.parse(last?.sleepEnd ?? '') - Date.parse(last?.sleepStart ?? '')) / 60_000;
    expect(minutes).toBe(Math.round((last?.sleepHours ?? 0) * 60) + (last?.sleepAwakeMin ?? 0));
    expect(new Date(last?.sleepEnd ?? '').getHours()).toBeGreaterThanOrEqual(6);
    await repo.store.dispose();
  });

  it('has Álex as friend, a confirmed long ride, a pending invite, feed and notifications', async () => {
    const repo = await signedInRepo();
    const friends = await repo.listFriends();
    expect(friends.find((f) => f.profile.username === 'alex')).toMatchObject({ status: 'accepted', direction: 'mutual' });
    expect(friends.find((f) => f.profile.username === 'lucia')).toMatchObject({ status: 'pending', direction: 'incoming' });

    const sessions = await repo.listJointSessions({ from: WEEK.from, to: NEXT_WEEK.to });
    const ride = sessions.find((s) => s.status === 'confirmed');
    expect(ride).toMatchObject({ sport: 'bike', organizerId: DEMO_USERS.diego });
    expect(ride?.participants.every((p) => p.status === 'accepted' && p.workoutId)).toBe(true);
    const mine = await repo.getWorkout(ride?.participants.find((p) => p.userId === DEMO_USERS.diego)?.workoutId ?? '');
    expect(mine?.jointSessionId).toBe(ride?.id);
    const invite = sessions.find((s) => s.status === 'proposed');
    expect(invite?.organizerId).toBe(DEMO_USERS.alex);
    expect(invite?.participants.find((p) => p.userId === DEMO_USERS.diego)?.status).toBe('invited');

    const feed = await repo.listFeed();
    expect(feed.length).toBeGreaterThanOrEqual(2);
    const notifications = await repo.listNotifications();
    const unreadTypes = notifications.filter((n) => n.readAt === null).map((n) => n.type);
    expect(unreadTypes).toEqual(expect.arrayContaining(['joint_invite', 'friend_request']));
    // The seeded proposal comes from the rules engine: like the DB trigger, no 'plan_updated'.
    expect(notifications.some((n) => n.type === 'plan_updated')).toBe(false);
    await repo.store.dispose();
  });

  it('has one pending rules proposal whose changes reference my workouts', async () => {
    const repo = await signedInRepo();
    const [proposal] = await repo.listProposals('pending');
    expect(proposal).toMatchObject({ source: 'rules', status: 'pending', weekStart: NEXT_WEEK.from });
    const mineIds = new Set((await repo.listWorkouts(NEXT_WEEK)).map((w) => w.id));
    proposal?.changes.forEach((c) => {
      if (c.op !== 'add') expect(mineIds.has(c.workoutId)).toBe(true);
    });
    await repo.store.dispose();
  });

  it('works when seeded mid-week (Wednesday)', async () => {
    const repo = await signedInRepo(WEDNESDAY);
    const today = '2026-10-21';
    const week = await repo.listWorkouts({ from: startOfWeek(today), to: addDays(startOfWeek(today), 6) });
    expect(week.some((w) => w.date < today && w.status !== 'planned')).toBe(true);
    expect(week.some((w) => w.date > today && w.status === 'planned')).toBe(true);
    const sessions = await repo.listJointSessions({ from: today, to: addDays(today, 14) });
    expect(sessions.every((s) => s.date > today)).toBe(true);
    await repo.store.dispose();
  });
});
