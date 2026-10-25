import { describe, expect, test } from '@jest/globals';

import type { JointSession, Race } from '@/domain/types';

import { buildWidgetProps, buildWidgetTimelines, linkBaseFor, partnerLabel, type WidgetDataInput } from '../widgets/props';
import { workout } from './fixtures';

// Monday 26 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 26, 10, 0);

const race: Race = {
  id: 'r1',
  userId: 'me',
  name: 'Media de Valencia',
  date: '2026-11-05',
  distance: 'half',
  priority: 'A',
  location: null,
  goal: null,
  notes: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

const joint: JointSession = {
  id: 'j1',
  organizerId: 'alex',
  sport: 'run',
  date: '2026-10-26',
  startTime: '19:00',
  durationMin: 60,
  intensity: 'endurance',
  title: 'Rodaje juntos',
  location: null,
  notes: null,
  status: 'confirmed',
  participants: [
    { userId: 'me', displayName: 'Diego', avatarUrl: null, status: 'accepted', workoutId: 'w3' },
    { userId: 'alex', displayName: 'Álex', avatarUrl: null, status: 'accepted', workoutId: 'x' },
  ],
  createdAt: '2026-10-20T10:00:00.000Z',
};

function input(overrides: Partial<WidgetDataInput> = {}): WidgetDataInput {
  return {
    workouts: [
      workout({ id: 'w1', date: '2026-10-26', startTime: '07:00', title: 'Natación', sport: 'swim', durationMin: 45, status: 'completed', completed: { durationMin: 45 } }),
      workout({ id: 'w2', date: '2026-10-26', startTime: '13:00', title: 'Fuerza', sport: 'strength', durationMin: 30 }),
      workout({ id: 'w3', date: '2026-10-26', startTime: '19:00', title: 'Rodaje juntos', durationMin: 60, jointSessionId: 'j1' }),
      workout({ id: 'w4', date: '2026-10-27', title: 'Rodillo Z2', sport: 'bike', durationMin: 75 }),
      workout({ id: 'w5', date: '2026-11-01', title: 'Descanso', sport: 'rest', durationMin: 0 }),
    ],
    races: [race],
    jointSessions: [joint],
    profile: null,
    linkBase: 'rebufo://',
    ...overrides,
  };
}

describe('buildWidgetProps', () => {
  test('today widget: lists, next pending session and partner', () => {
    const { today } = buildWidgetProps(input(), NOW);
    expect(today.today.map((s) => s.id)).toEqual(['w1', 'w2', 'w3']);
    expect(today.today[0]?.done).toBe(true);
    expect(today.next?.id).toBe('w2');
    expect(today.tomorrow.map((s) => s.id)).toEqual(['w4']);
    expect(today.today[2]?.partner).toBe('con Álex');
    expect(today.today[1]?.time).toBe('13:00');
    expect(today.today[1]?.duration).toBe("30'");
    expect(today.allDoneToday).toBe(false);
    expect(today.linkBase).toBe('rebufo://');
  });

  test('today widget: week strip and progress', () => {
    const { today } = buildWidgetProps(input(), NOW);
    expect(today.week).toHaveLength(7);
    expect(today.week[0]).toMatchObject({ letter: 'L', day: '26', isToday: true, done: false });
    expect(today.week[0]?.sports).toEqual(['swim', 'strength', 'run']);
    expect(today.week[6]?.sports).toEqual([]);
    // 45 of 210 planned minutes (rest excluded) → 21 %
    expect(today.weekPercent).toBe(21);
    expect(today.weekSummary).toBe("1/4 sesiones · 45' de 3h 30'");
  });

  test('a finished timed session is no longer "next"', () => {
    const { today, next } = buildWidgetProps(input(), new Date(2026, 9, 26, 13, 45));
    expect(today.next?.id).toBe('w3');
    expect(next.next?.id).toBe('w3');
    expect(next.next?.when).toBe('Hoy 19:00');
  });

  test('rest day: no next session today, lock screen shows tomorrow', () => {
    const { today, next } = buildWidgetProps(input(), new Date(2026, 9, 26, 21, 0));
    expect(today.next).toBeNull();
    expect(next.next?.id).toBe('w4');
    expect(next.next?.when).toBe('Mañana');
  });

  test('race widget: countdown and labels', () => {
    const { race: r } = buildWidgetProps(input(), NOW);
    expect(r.raceName).toBe('Media de Valencia');
    expect(r.daysToRace).toBe(10);
    expect(r.distanceLabel.length).toBeGreaterThan(0);
    expect(r.weekPercent).toBe(21);
  });

  test('race widget: empty state without races', () => {
    const { race: r } = buildWidgetProps(input({ races: [] }), NOW);
    expect(r.raceName).toBeNull();
    expect(r.daysToRace).toBeNull();
  });

  test('empty plan renders empty states', () => {
    const props = buildWidgetProps(input({ workouts: [], races: [] }), NOW);
    expect(props.today.today).toEqual([]);
    expect(props.today.next).toBeNull();
    expect(props.today.weekPercent).toBe(0);
    expect(props.next.next).toBeNull();
  });
});

describe('buildWidgetTimelines', () => {
  test('one entry now plus one per midnight; lock screen also after each timed session', () => {
    const timelines = buildWidgetTimelines(input(), NOW, { days: 7 });
    expect(timelines.today).toHaveLength(8);
    expect(timelines.today[1]?.date).toEqual(new Date(2026, 9, 27, 0, 0));
    expect(timelines.today[1]?.props.today.map((s) => s.id)).toEqual(['w4']);
    expect(timelines.race[1]?.props.daysToRace).toBe(9);
    const nextDates = timelines.next.map((e) => e.date.getTime());
    expect(nextDates).toContain(new Date(2026, 9, 26, 13, 30).getTime());
    expect(nextDates).toContain(new Date(2026, 9, 26, 20, 0).getTime());
    expect([...nextDates].sort((a, b) => a - b)).toEqual(nextDates);
  });
});

describe('helpers', () => {
  test('linkBaseFor uses the app scheme', () => {
    expect(linkBaseFor('rebufo-dev')).toBe('rebufo-dev://');
    expect(linkBaseFor(['rebufo', 'other'])).toBe('rebufo://');
    expect(linkBaseFor(undefined)).toBe('rebufo://');
  });

  test('partnerLabel ignores me and declined participants', () => {
    const w = workout({ id: 'w3', date: '2026-10-26', jointSessionId: 'j1' });
    expect(partnerLabel(w, [joint], 'me')).toBe('con Álex');
    expect(partnerLabel(w, [], 'me')).toBe('Quedada');
    expect(partnerLabel(workout({ id: 'x', date: '2026-10-26' }), [joint], 'me')).toBe('');
  });
});
