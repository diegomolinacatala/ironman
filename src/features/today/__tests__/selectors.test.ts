import { describe, expect, test } from '@jest/globals';

import type { AppNotification, DailyCheckin } from '@/domain/types';
import { ALEX, ME, makeSession, makeWorkout } from '@/features/workouts/__tests__/fixtures';

import { checkinFor, organizerName, pendingInvites, planForToday, todayHeadline, unreadCount, workoutsOn } from '../selectors';

const TODAY = '2026-10-25';

describe('todayHeadline', () => {
  test('builds "weekday day month" in Spanish', () => {
    expect(todayHeadline('2026-10-25')).toBe('domingo 25 oct');
    expect(todayHeadline('2026-10-24')).toBe('sábado 24 oct');
    expect(todayHeadline('2027-01-04')).toBe('lunes 4 ene');
  });
});

describe('planForToday', () => {
  test('hero is the first planned training session by start time', () => {
    const list = [
      makeWorkout({ id: 'swim', sport: 'swim', startTime: '19:00' }),
      makeWorkout({ id: 'run', startTime: '07:30', status: 'completed' }),
      makeWorkout({ id: 'gym', sport: 'strength', startTime: '13:00' }),
      makeWorkout({ id: 'tomorrow', date: '2026-10-26' }),
    ];
    const plan = planForToday(list, TODAY);
    expect(plan.hero?.id).toBe('gym');
    expect(plan.others.map((w) => w.id)).toEqual(['run', 'swim']);
    expect(plan.isRestDay).toBe(false);
    expect(plan.allDone).toBe(false);
  });

  test('rest-only days are rest days', () => {
    const plan = planForToday([makeWorkout({ sport: 'rest', durationMin: 0 })], TODAY);
    expect(plan.hero).toBeNull();
    expect(plan.isRestDay).toBe(true);
    expect(plan.allDone).toBe(false);
  });

  test('all done when every session is completed or skipped', () => {
    const plan = planForToday(
      [makeWorkout({ id: 'a', status: 'completed' }), makeWorkout({ id: 'b', status: 'skipped' })],
      TODAY,
    );
    expect(plan.hero).toBeNull();
    expect(plan.allDone).toBe(true);
    expect(plan.others).toHaveLength(2);
  });

  test('empty day is a rest day', () => {
    expect(planForToday([], TODAY).isRestDay).toBe(true);
  });

  test('does not mutate the input list', () => {
    const list = [makeWorkout({ id: 'late', startTime: '20:00' }), makeWorkout({ id: 'early', startTime: '06:00' })];
    workoutsOn(list, TODAY);
    expect(list.map((w) => w.id)).toEqual(['late', 'early']);
  });
});

describe('pendingInvites', () => {
  test('keeps future sessions where I am invited by someone else', () => {
    const invited = makeSession();
    const mine = makeSession({ id: 's2', organizerId: ME });
    const cancelled = makeSession({ id: 's3', status: 'cancelled' });
    const past = makeSession({ id: 's4', date: '2026-10-20' });
    const answered = makeSession({
      id: 's5',
      participants: [
        { userId: ALEX, displayName: 'Álex', avatarUrl: null, status: 'accepted', workoutId: null },
        { userId: ME, displayName: 'Diego', avatarUrl: null, status: 'accepted', workoutId: 'w9' },
      ],
    });
    expect(pendingInvites([invited, mine, cancelled, past, answered], ME, TODAY).map((s) => s.id)).toEqual(['s1']);
    expect(pendingInvites([invited], undefined, TODAY)).toEqual([]);
  });

  test('organizer name uses the first name', () => {
    expect(organizerName(makeSession())).toBe('Álex');
    expect(organizerName(makeSession({ organizerId: 'ghost' }))).toBe('Un amigo');
  });
});

describe('unreadCount / checkinFor', () => {
  const note = (id: string, readAt: string | null): AppNotification => ({
    id,
    userId: ME,
    type: 'kudos',
    title: 't',
    body: 'b',
    data: {},
    readAt,
    createdAt: '2026-10-25T08:00:00.000Z',
  });

  test('counts notifications without readAt', () => {
    expect(unreadCount([note('a', null), note('b', '2026-10-25T09:00:00.000Z'), note('c', null)])).toBe(2);
    expect(unreadCount(undefined)).toBe(0);
  });

  test('finds the check-in of a date', () => {
    const checkin: DailyCheckin = {
      userId: ME,
      date: TODAY,
      sleepQuality: 4,
      sleepHours: 7.5,
      fatigue: 2,
      soreness: 2,
      stress: 3,
      motivation: 4,
      notes: null,
    };
    expect(checkinFor([checkin], TODAY)).toBe(checkin);
    expect(checkinFor([checkin], '2026-10-24')).toBeNull();
    expect(checkinFor(undefined, TODAY)).toBeNull();
  });
});
