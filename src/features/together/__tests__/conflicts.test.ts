import { describe, expect, test } from '@jest/globals';

import { conflictMessage, findConflicts, friendDayEntries, isSameSportMatch, matchMessage, myDayEntries, sameDayMessage } from '../conflicts';
import type { BusySegment } from '../types';

import { friendItem, workout } from './fixtures';

const DATE = '2026-10-27';
const busy: BusySegment[] = [{ key: 'b1:2026-10-27', date: DATE, start: '09:00', end: '14:00', title: 'Clase' }];

describe('myDayEntries', () => {
  test('includes busy and workouts of that day, excluding skipped, rest and the linked workout', () => {
    const entries = myDayEntries(
      DATE,
      [
        workout({ id: 'a', startTime: '18:00' }),
        workout({ id: 'b', status: 'skipped' }),
        workout({ id: 'c', sport: 'rest' }),
        workout({ id: 'd', date: '2026-10-28' }),
        workout({ id: 'linked', startTime: '07:00' }),
      ],
      busy,
      'linked',
    );
    expect(entries).toEqual([
      { kind: 'busy', sport: null, title: 'Clase', start: '09:00', end: '14:00' },
      { kind: 'workout', sport: 'run', title: 'Rodaje Z2', start: '18:00', end: '19:00' },
    ]);
  });
});

describe('friendDayEntries', () => {
  test('masks busy titles and derives end from duration', () => {
    const entries = friendDayEntries(DATE, [
      friendItem({ kind: 'busy', startTime: '18:00', endTime: '19:00', title: 'secreto', durationMin: null, sport: null }),
      friendItem({ startTime: '07:00', durationMin: 45 }),
      friendItem({ date: '2026-10-28' }),
    ]);
    expect(entries).toEqual([
      { kind: 'busy', sport: null, title: null, start: '18:00', end: '19:00' },
      { kind: 'workout', sport: 'swim', title: 'Técnica', start: '07:00', end: '07:45' },
    ]);
  });
});

describe('findConflicts', () => {
  const entries = [
    { kind: 'busy' as const, sport: null, title: null, start: '18:00', end: '19:00' },
    { kind: 'workout' as const, sport: 'swim' as const, title: 'Técnica', start: '07:00', end: '07:45' },
    { kind: 'workout' as const, sport: 'strength' as const, title: 'Fuerza', start: null, end: null },
  ];

  test('reports overlapping timed entries and untimed sessions of the day', () => {
    const report = findConflicts(entries, '18:30', 60);
    expect(report.overlaps).toEqual([entries[0]]);
    expect(report.sameDay).toEqual([entries[2]]);
  });

  test('touching edges do not overlap', () => {
    expect(findConflicts(entries, '19:00', 30).overlaps).toEqual([]);
    expect(findConflicts(entries, '17:00', 60).overlaps).toEqual([]);
  });

  test('without a start time there are no overlaps', () => {
    expect(findConflicts(entries, null, 60).overlaps).toEqual([]);
  });
});

describe('messages', () => {
  const friend = { isMe: false, name: 'Álex' };
  const me = { isMe: true, name: 'Tú' };

  test('friend messages never reveal busy titles', () => {
    expect(conflictMessage({ kind: 'busy', sport: null, title: null, start: '18:00', end: '19:00' }, friend)).toBe('Álex está ocupado 18:00–19:00');
    expect(conflictMessage({ kind: 'workout', sport: null, title: null, start: '07:00', end: '08:00' }, friend)).toBe('Álex tiene un entreno 07:00–08:00');
    expect(conflictMessage({ kind: 'workout', sport: null, title: 'Series', start: '07:00', end: '08:00' }, friend)).toBe('Álex tiene «Series» 07:00–08:00');
    expect(conflictMessage({ kind: 'event', sport: null, title: 'Pádel', start: '20:00', end: '21:30' }, friend)).toBe('Álex tiene un plan 20:00–21:30');
  });

  test('same-sport overlaps are matches', () => {
    const entry = { kind: 'workout' as const, sport: 'run' as const, title: 'Tirada larga', start: '09:30', end: '10:55' };
    expect(isSameSportMatch(entry, 'run')).toBe(true);
    expect(isSameSportMatch(entry, 'bike')).toBe(false);
    expect(isSameSportMatch({ ...entry, kind: 'busy' }, 'run')).toBe(false);
    expect(matchMessage(entry, 'Álex')).toBe('Álex tiene «Tirada larga» 09:30–10:55: mismo deporte, ¿lo hacéis juntos?');
  });

  test('my messages use my own titles', () => {
    expect(conflictMessage({ kind: 'busy', sport: null, title: 'Clase', start: '09:00', end: '14:00' }, me)).toBe('Tienes «Clase» 09:00–14:00');
    expect(conflictMessage({ kind: 'busy', sport: null, title: null, start: '09:00', end: '14:00' }, me)).toBe('Estás ocupado 09:00–14:00');
    expect(sameDayMessage({ kind: 'workout', sport: null, title: 'Fuerza', start: null, end: null }, me)).toBe('Ya tienes «Fuerza» ese día (sin hora)');
    expect(sameDayMessage({ kind: 'workout', sport: null, title: null, start: null, end: null }, friend)).toBe('Álex ya tiene un entreno ese día (sin hora)');
  });
});
