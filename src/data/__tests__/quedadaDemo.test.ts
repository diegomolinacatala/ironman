/// <reference types="jest" />
import type { Friend, FriendWeekItem, Workout } from '@/domain/types';

import { DEMO_USERS } from '../demo/ids';
import { quedadaReplyLine, suggestDemoQuedada } from '../demo/repo/quedadaDemo';
import { resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

const DAVID: Friend = {
  friendshipId: 'fs1',
  profile: { id: 'david-id', username: 'davidm', displayName: 'David', avatarUrl: null, sports: [] },
  status: 'accepted',
  direction: 'mutual',
  visibility: 'full',
  createdAt: '2026-10-01T10:00:00.000Z',
};

const RANGE = { from: '2026-11-02', to: '2026-11-02' };

function busyFriend(start: string, end: string): FriendWeekItem {
  return { kind: 'busy', id: null, date: '2026-11-02', startTime: start, endTime: end, durationMin: null, sport: null, intensity: null, title: null, status: null, jointSessionId: null };
}

describe('suggestDemoQuedada', () => {
  it('picks the first common free slot inside my windows', () => {
    const mine = [{ weekday: 0 as const, start: '07:00', end: '10:00' }];
    const quedada = suggestDemoQuedada({ friend: DAVID, range: RANGE, myWorkouts: [], myBusy: [], myWindows: mine, friendItems: [busyFriend('06:00', '08:00')] });
    expect(quedada).toMatchObject({ friendId: 'david-id', friendName: 'David', sport: 'run', date: '2026-11-02', durationMin: 60, intensity: 'endurance', title: 'Rodaje juntos', location: null });
    // Busy until 08:00 plus the 15' travel margin.
    expect(quedada?.startTime).toBe('08:15');
    expect(quedada?.reason).toMatch(/^Los dos tenéis libre el lun 2 nov/);
    expect(quedadaReplyLine(quedada!)).toMatch(/^Te propongo quedar con David el lun 2 nov a las 08:15/);
  });

  it('returns null when there is no common slot of an hour', () => {
    const mine = [{ weekday: 0 as const, start: '07:00', end: '09:00' }];
    const myWorkout = { id: 'w', date: '2026-11-02', startTime: '07:00', durationMin: 90, sport: 'swim', status: 'planned' } as Workout;
    expect(suggestDemoQuedada({ friend: DAVID, range: RANGE, myWorkouts: [myWorkout], myBusy: [], myWindows: mine, friendItems: [] })).toBeNull();
  });
});

describe('demo coach quedadas', () => {
  it('suggests a quedada with a requested friend in a chat (and says so in the reply)', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-26', message: 'quiero rodar con Álex', friendIds: [DEMO_USERS.alex] });
    expect(response.quedada).toMatchObject({ friendId: DEMO_USERS.alex, sport: 'run', durationMin: 60 });
    const date = response.quedada?.date ?? '';
    expect(date >= '2026-10-26' && date <= '2026-11-08').toBe(true);
    expect(response.reply).toContain('Te propongo quedar con');
    await repo.store.dispose();
  });

  it('no quedada without friendIds, for non-friends or outside a chat', async () => {
    const repo = await signedInRepo();
    expect((await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-26', message: 'hola' })).quedada).toBeNull();
    expect((await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-26', message: 'con Marcos', friendIds: [DEMO_USERS.marcos] })).quedada).toBeNull();
    expect((await repo.requestCoach({ mode: 'plan_week', weekStart: '2026-11-09', friendIds: [DEMO_USERS.alex] })).quedada).toBeNull();
    await repo.store.dispose();
  });
});
