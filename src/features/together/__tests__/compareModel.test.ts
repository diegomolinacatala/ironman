import { describe, expect, test } from '@jest/globals';

import { buildCompareDays, defaultCompareWeek, friendEntry, futureSlots, inferVisibility, slotsByDay, totalSlotMinutes } from '../compareModel';
import type { BusySegment, Slot } from '../types';

import { friendItem, workout } from './fixtures';

const RANGE = { from: '2026-10-26', to: '2026-11-01' };

describe('buildCompareDays', () => {
  const myBusy: BusySegment[] = [{ key: 'b1:2026-10-27', date: '2026-10-27', start: '09:00', end: '14:00', title: 'Clase' }];
  const slots: Slot[] = [{ date: '2026-10-27', start: '15:00', end: '17:30', minutes: 150 }];

  test('creates seven days with lanes sorted by time (untimed last)', () => {
    const days = buildCompareDays({
      range: RANGE,
      today: '2026-10-27',
      myWorkouts: [workout({ id: 'late', startTime: '19:00' }), workout({ id: 'untimed', startTime: null }), workout({ id: 'other-day', date: '2026-10-29' })],
      myBusy,
      friendItems: [friendItem({ startTime: '20:00', id: 'x' }), friendItem({ startTime: '07:00', id: 'y' })],
      slots,
    });
    expect(days).toHaveLength(7);
    const tuesday = days[1];
    expect(tuesday?.date).toBe('2026-10-27');
    expect(tuesday?.isToday).toBe(true);
    expect(days[0]?.isPast).toBe(true);
    expect(tuesday?.mine.map((e) => e.key)).toEqual(['b:b1:2026-10-27', 'w:late', 'w:untimed']);
    expect(tuesday?.theirs.map((e) => e.startTime)).toEqual(['07:00', '20:00']);
    expect(tuesday?.slots).toEqual(slots);
    expect(days[3]?.mine.map((e) => e.key)).toEqual(['w:other-day']);
  });

  test('my workout entries keep the workout and compute the end', () => {
    const days = buildCompareDays({ range: RANGE, today: '2026-10-25', myWorkouts: [workout({ startTime: '18:00', durationMin: 75 })], myBusy: [], friendItems: [], slots: [] });
    const entry = days[1]?.mine[0];
    expect(entry?.endTime).toBe('19:15');
    expect(entry?.workout?.id).toBe('w1');
  });
});

describe('friendEntry', () => {
  test('never exposes busy titles and derives the end time', () => {
    expect(friendEntry(friendItem({ kind: 'busy', title: 'Médico', startTime: '10:00', endTime: '11:00' }), 0).title).toBeNull();
    expect(friendEntry(friendItem({ startTime: '07:00', durationMin: 45 }), 0).endTime).toBe('07:45');
    expect(friendEntry(friendItem({ id: null }), 3).key).toBe('f:2026-10-27-3:workout');
  });
});

describe('inferVisibility', () => {
  test('infers from what the friend shares', () => {
    expect(inferVisibility([friendItem()])).toBe('full');
    expect(inferVisibility([friendItem({ title: null })])).toBe('summary');
    expect(inferVisibility([friendItem({ kind: 'busy', title: null, sport: null })])).toBe('busy');
    expect(inferVisibility([])).toBeNull();
  });
});

describe('futureSlots', () => {
  const slots: Slot[] = [
    { date: '2026-10-24', start: '10:00', end: '12:00', minutes: 120 },
    { date: '2026-10-25', start: '08:00', end: '10:00', minutes: 120 },
    { date: '2026-10-25', start: '16:00', end: '20:00', minutes: 240 },
    { date: '2026-10-25', start: '17:00', end: '17:50', minutes: 50 },
    { date: '2026-10-26', start: '07:00', end: '08:00', minutes: 60 },
  ];

  test('drops past slots and trims today to now rounded to 15 minutes', () => {
    const now = new Date(2026, 9, 25, 17, 7);
    expect(futureSlots(slots, now)).toEqual([
      { date: '2026-10-25', start: '17:15', end: '20:00', minutes: 165 },
      { date: '2026-10-26', start: '07:00', end: '08:00', minutes: 60 },
    ]);
  });
});

describe('slot helpers', () => {
  const slots: Slot[] = [
    { date: '2026-10-28', start: '19:00', end: '20:00', minutes: 60 },
    { date: '2026-10-27', start: '15:00', end: '16:00', minutes: 60 },
    { date: '2026-10-28', start: '07:00', end: '08:30', minutes: 90 },
  ];

  test('groups by day in order and sums minutes', () => {
    expect(slotsByDay(slots).map((d) => [d.date, d.slots.map((s) => s.start)])).toEqual([
      ['2026-10-27', ['15:00']],
      ['2026-10-28', ['07:00', '19:00']],
    ]);
    expect(totalSlotMinutes(slots)).toBe(210);
  });
});

describe('defaultCompareWeek', () => {
  test('current week, except on Sunday', () => {
    expect(defaultCompareWeek('2026-10-21')).toBe('2026-10-19');
    expect(defaultCompareWeek('2026-10-24')).toBe('2026-10-19');
    expect(defaultCompareWeek('2026-10-25')).toBe('2026-10-26');
  });
});
