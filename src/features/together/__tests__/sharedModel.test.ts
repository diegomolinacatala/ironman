import { describe, expect, test } from '@jest/globals';

import type { FriendRace, FriendWeekItem, Race } from '@/domain/types';
import { describeFeedItem, joinNames } from '@/features/social/feedText';

import { countdownLabel, friendVolume, hasTodaySocial, isSameRace, myVolume, sharedRaces, todaySocial } from '../sharedModel';
import { ALEX, feedItem, jointSession, ME, participant, workout } from './fixtures';

const TODAY = '2026-10-27';

function friendItem(patch: Partial<FriendWeekItem>): FriendWeekItem {
  return {
    kind: 'workout',
    id: 'fw1',
    date: TODAY,
    startTime: '07:00',
    endTime: null,
    durationMin: 60,
    sport: 'run',
    intensity: 'endurance',
    title: null,
    status: 'planned',
    jointSessionId: null,
    ...patch,
  };
}

function race(patch: Partial<Race> = {}): Race {
  return {
    id: 'r1',
    userId: ME,
    name: 'IRONMAN Barcelona',
    date: '2027-10-02',
    distance: 'full',
    priority: 'A',
    location: null,
    goal: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...patch,
  } as Race;
}

function friendRace(patch: Partial<FriendRace> = {}): FriendRace {
  return { friendId: ALEX, displayName: 'Álex García', raceId: 'fr1', name: 'Ironman Barcelona', date: '2027-10-02', distance: 'full', priority: 'A', ...patch };
}

describe('weekly volume', () => {
  test('mine counts planned + completed minutes, skips rest and skipped', () => {
    const v = myVolume([
      workout({ id: 'a', durationMin: 60, status: 'completed', completed: { durationMin: 70 } as never }),
      workout({ id: 'b', durationMin: 90, status: 'planned' }),
      workout({ id: 'c', durationMin: 45, status: 'skipped' }),
      workout({ id: 'd', sport: 'rest', durationMin: 0 }),
    ]);
    expect(v).toEqual({ totalMin: 160, doneMin: 70, sessions: 2 });
  });

  test("friend's volume is null for 'busy' visibility", () => {
    const items = [friendItem({ status: 'completed' }), friendItem({ id: 'x', durationMin: 30 }), friendItem({ kind: 'busy', durationMin: null, sport: null })];
    expect(friendVolume(items, 'summary')).toEqual({ totalMin: 90, doneMin: 60, sessions: 2 });
    expect(friendVolume(items, 'busy')).toBeNull();
  });
});

describe('shared races', () => {
  test('same day and same distance or same name', () => {
    expect(isSameRace(race(), friendRace())).toBe(true);
    expect(isSameRace(race(), friendRace({ distance: 'half', name: 'ironman  barcelona' }))).toBe(true);
    expect(isSameRace(race(), friendRace({ distance: 'half', name: null }))).toBe(false);
    expect(isSameRace(race(), friendRace({ date: '2027-10-03' }))).toBe(false);
  });

  test('lists my upcoming races shared with friends, soonest first', () => {
    const shared = sharedRaces([race(), race({ id: 'old', date: '2026-01-01' })], [friendRace()], TODAY);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.friends.map((f) => f.friendId)).toEqual([ALEX]);
    expect(countdownLabel(shared[0]?.daysLeft ?? 0)).toMatch(/^Faltan \d+ días$/);
    expect(countdownLabel(1)).toBe('Es mañana');
    expect(countdownLabel(0)).toBe('Es hoy');
  });
});

describe('Hoy social', () => {
  test("today's accepted quedadas, friends' last 24 h and open quedadas", () => {
    const now = new Date('2026-10-27T12:00:00Z');
    const mine = jointSession({ id: 'today', date: TODAY, status: 'confirmed', participants: [participant({ userId: ALEX, displayName: 'Álex' }), participant()] });
    const invited = jointSession({ id: 'inv', date: TODAY });
    const social = todaySocial({
      myId: ME,
      today: TODAY,
      now,
      joint: [mine, invited],
      feed: [feedItem({ createdAt: '2026-10-27T08:00:00Z' }), feedItem({ id: 'old', createdAt: '2026-10-25T08:00:00Z' })],
      open: [jointSession({ id: 'open', isOpen: true })],
    });
    expect(social.todayJoint.map((s) => s.id)).toEqual(['today']);
    expect(social.recent.map((f) => f.id)).toEqual(['f1']);
    expect(social.open.map((s) => s.id)).toEqual(['open']);
    expect(hasTodaySocial(social)).toBe(true);
    expect(hasTodaySocial({ todayJoint: [], recent: [], open: [] })).toBe(false);
  });
});

describe('feed: entrenasteis juntos', () => {
  test('names the other participants, "contigo" for me', () => {
    const item = feedItem({ type: 'joint_completed', payload: { sport: 'run', title: 'Tirada', durationMin: 90, participants: ['Diego', 'Álex'] } });
    expect(describeFeedItem(item, ME, TODAY, 'Diego')).toMatchObject({ actor: 'Álex', action: 'entrenó contigo: Tirada' });
    expect(describeFeedItem(item, 'someone', TODAY)).toMatchObject({ action: 'entrenó con Diego: Tirada' });
    const mine = feedItem({ type: 'joint_completed', actor: { id: ME, username: 'diego', displayName: 'Diego', avatarUrl: null, sports: [] }, payload: { participants: ['Diego', 'Álex'], othersCount: 1 } });
    expect(describeFeedItem(mine, ME, TODAY, 'Diego')).toMatchObject({ actor: 'Tú', action: 'entrenaste con Álex y otra persona' });
    expect(describeFeedItem(item, ME, TODAY).detail).toBe('Entrenasteis juntos · 1h 30\'');
  });

  test('joinNames', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B y C');
  });
});
