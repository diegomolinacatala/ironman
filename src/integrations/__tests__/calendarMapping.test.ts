import { describe, expect, test } from '@jest/globals';

import { isBlockingEvent, mapEventsToBusyBlocks, rangeToWindow, type CalendarEventLike } from '../calendar/mapping';

const WINDOW = rangeToWindow({ from: '2026-10-26', to: '2026-11-08' });

function event(overrides: Partial<CalendarEventLike> = {}): CalendarEventLike {
  return {
    id: 'ev-1',
    title: 'Clase de Estadística',
    startDate: new Date(2026, 9, 27, 9, 0),
    endDate: new Date(2026, 9, 27, 11, 0),
    allDay: false,
    availability: 'busy',
    status: 'confirmed',
    ...overrides,
  };
}

describe('rangeToWindow', () => {
  test('covers from 00:00 to the day after `to`', () => {
    expect(WINDOW.start).toEqual(new Date(2026, 9, 26, 0, 0));
    expect(WINDOW.end).toEqual(new Date(2026, 10, 9, 0, 0));
  });
});

describe('mapEventsToBusyBlocks', () => {
  test('maps a timed event to a private busy block (no notes/location/attendees)', () => {
    const blocks = mapEventsToBusyBlocks([{ ...event(), ...{ notes: 'secret', location: 'Aula 3' } } as CalendarEventLike], WINDOW);
    expect(blocks).toEqual([
      {
        start: new Date(2026, 9, 27, 9, 0).toISOString(),
        end: new Date(2026, 9, 27, 11, 0).toISOString(),
        source: 'device_calendar',
        title: 'Clase de Estadística',
        externalId: 'ev-1',
      },
    ]);
    expect(Object.keys(blocks[0] ?? {})).not.toContain('notes');
  });

  test('skips all-day, free and cancelled events', () => {
    expect(isBlockingEvent(event({ allDay: true }))).toBe(false);
    expect(isBlockingEvent(event({ availability: 'free' }))).toBe(false);
    expect(isBlockingEvent(event({ status: 'canceled' }))).toBe(false);
    expect(isBlockingEvent(event({ availability: 'tentative' }))).toBe(true);
    const blocks = mapEventsToBusyBlocks([event({ allDay: true }), event({ id: 'b', availability: 'free' })], WINDOW);
    expect(blocks).toEqual([]);
  });

  test('clamps long events to 24 h and clips them to the window', () => {
    const trip = event({ id: 'trip', startDate: new Date(2026, 10, 7, 8, 0), endDate: new Date(2026, 10, 12, 20, 0) });
    const [block] = mapEventsToBusyBlocks([trip], WINDOW);
    expect(block?.start).toBe(new Date(2026, 10, 7, 8, 0).toISOString());
    expect(block?.end).toBe(new Date(2026, 10, 8, 8, 0).toISOString());

    const early = event({ id: 'early', startDate: new Date(2026, 9, 25, 22, 0), endDate: new Date(2026, 9, 26, 2, 0) });
    expect(mapEventsToBusyBlocks([early], WINDOW)[0]?.start).toBe(new Date(2026, 9, 26, 0, 0).toISOString());
  });

  test('accepts ISO strings, drops invalid ranges and duplicates, sorts by start', () => {
    const later = event({ id: 'later', startDate: new Date(2026, 9, 29, 16, 0).toISOString(), endDate: new Date(2026, 9, 29, 17, 0).toISOString() });
    const invalid = event({ id: 'bad', startDate: 'nope', endDate: 'nope' });
    const inverted = event({ id: 'inv', startDate: new Date(2026, 9, 28, 12, 0), endDate: new Date(2026, 9, 28, 11, 0) });
    const blocks = mapEventsToBusyBlocks([later, event(), event(), invalid, inverted], WINDOW);
    expect(blocks.map((b) => b.externalId)).toEqual(['ev-1', 'later']);
  });

  test('empty titles become null and long ones are truncated to 200 chars', () => {
    expect(mapEventsToBusyBlocks([event({ title: '   ' })], WINDOW)[0]?.title).toBeNull();
    expect(mapEventsToBusyBlocks([event({ title: 'x'.repeat(300) })], WINDOW)[0]?.title).toHaveLength(200);
  });
});
