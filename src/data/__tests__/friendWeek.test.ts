/// <reference types="jest" />
import type { BusyBlock, LifeEvent, Workout } from '@/domain/types';

import { maskFriendWeek, splitBusyBlock } from '../demo/friendWeek';
import { localIso } from '../demo/ids';

const FRIEND = 'friend';
const RANGE = { from: '2026-10-26', to: '2026-11-01' };
const NOW = '2026-10-25T10:00:00.000Z';

function workout(partial: Partial<Workout>): Workout {
  return {
    id: 'w',
    userId: FRIEND,
    date: '2026-10-27',
    startTime: '19:30',
    sport: 'run',
    title: 'Series secretas',
    description: 'privado',
    durationMin: 50,
    distanceM: null,
    intensity: 'vo2',
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'manual',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function event(partial: Partial<LifeEvent>): LifeEvent {
  return {
    id: 'e',
    userId: FRIEND,
    kind: 'padel',
    title: 'Pádel con el jefe',
    startDate: '2026-10-28',
    endDate: '2026-10-28',
    startTime: '20:00',
    durationMin: 90,
    severity: 2,
    bodyArea: null,
    notes: 'nota privada',
    createdAt: NOW,
    ...partial,
  };
}

const busy: BusyBlock = {
  id: 'b',
  userId: FRIEND,
  start: localIso('2026-10-27', '09:00'),
  end: localIso('2026-10-27', '17:30'),
  source: 'device_calendar',
  title: 'Médico — privado',
  externalId: null,
};

const input = {
  range: RANGE,
  workouts: [
    workout({ id: 'w1' }),
    workout({ id: 'w2', date: '2026-10-29', startTime: null, sport: 'swim', title: 'Nado', intensity: 'endurance' }),
    workout({ id: 'w3', date: '2026-10-30', status: 'skipped' }),
    workout({ id: 'out', date: '2026-11-05' }),
  ],
  busyBlocks: [busy],
  lifeEvents: [
    event({ id: 'e1' }),
    event({ id: 'e2', kind: 'injury', title: 'Rodilla', startTime: null, durationMin: null }),
    event({ id: 'e3', kind: 'travel', title: 'Viaje a Bilbao', startDate: '2026-10-31', endDate: '2026-11-03', startTime: null, durationMin: null }),
  ],
};

describe('maskFriendWeek', () => {
  it('full: workouts with titles, shareable events, busy blocks without title', () => {
    const items = maskFriendWeek({ ...input, visibility: 'full' });
    const w1 = items.find((i) => i.id === 'w1');
    expect(w1).toMatchObject({ kind: 'workout', title: 'Series secretas', sport: 'run', startTime: '19:30', endTime: '20:20' });
    expect(items.find((i) => i.id === 'out')).toBeUndefined();
    const busyItems = items.filter((i) => i.kind === 'busy');
    expect(busyItems).toEqual([expect.objectContaining({ date: '2026-10-27', startTime: '09:00', endTime: '17:30', title: null, id: null })]);
    expect(items.find((i) => i.id === 'e1')).toMatchObject({ kind: 'event', title: 'Pádel con el jefe', sport: null, startTime: '20:00', endTime: '21:30' });
    // Health events are never shared; travel is clipped to the range (31 Oct + 1 Nov).
    expect(items.some((i) => i.id === 'e2')).toBe(false);
    expect(items.filter((i) => i.id === 'e3').map((i) => i.date)).toEqual(['2026-10-31', '2026-11-01']);
    expect(busyItems[0]?.durationMin).toBe(510);
    expect(JSON.stringify(items)).not.toContain('privado');
  });

  it('summary: same items without titles', () => {
    const items = maskFriendWeek({ ...input, visibility: 'summary' });
    expect(items.find((i) => i.id === 'w1')).toMatchObject({ kind: 'workout', sport: 'run', title: null, durationMin: 50 });
    expect(items.every((i) => i.title === null)).toBe(true);
  });

  it('busy: only busy intervals (timed workouts, blocks, timed/travel events)', () => {
    const items = maskFriendWeek({ ...input, visibility: 'busy' });
    expect(items.every((i) => i.kind === 'busy' && i.id === null && i.sport === null && i.title === null)).toBe(true);
    // w1 (timed) + busy block + pádel + 2 travel days; untimed w2 and skipped w3 are hidden.
    expect(items).toHaveLength(5);
    expect(items.find((i) => i.date === '2026-10-27' && i.startTime === '19:30')).toMatchObject({ endTime: '20:20', durationMin: 50 });
    // Untimed travel days are whole days (like the SQL: 00:00–23:59, 1440 min).
    expect(items.find((i) => i.date === '2026-10-31')).toMatchObject({ startTime: '00:00', endTime: '23:59', durationMin: 1440 });
  });
});

describe('splitBusyBlock', () => {
  it('splits blocks crossing midnight per day', () => {
    const parts = splitBusyBlock({ start: localIso('2026-10-27', '22:00'), end: localIso('2026-10-28', '02:00') }, RANGE);
    expect(parts.map((p) => [p.date, p.startTime, p.endTime, p.durationMin])).toEqual([
      ['2026-10-27', '22:00', '23:59', 120],
      ['2026-10-28', '00:00', '02:00', 120],
    ]);
  });

  it('clips to the range', () => {
    expect(splitBusyBlock({ start: localIso('2026-10-25', '22:00'), end: localIso('2026-10-26', '01:00') }, RANGE)).toHaveLength(1);
  });
});
