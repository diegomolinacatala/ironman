import { describe, expect, test } from '@jest/globals';

import type { Workout } from '@/domain/types';

import {
  eventDetails,
  eventNotes,
  eventSignature,
  eventTitle,
  planCalendarSync,
  trainingCalendarWindow,
  workoutIdFromUrl,
  type CalendarSyncInput,
  type ExistingEvent,
} from '../calendar/trainingEvents';
import { isValidTimeZone, zonedDateTime } from '../time';
import { workout } from './fixtures';

const TODAY = '2026-10-27';
const LINK = 'roadtoironman://';
const OPTS = { linkBase: LINK, alarmMinutes: 30, timeZone: 'Europe/Madrid' };

function input(overrides: Partial<CalendarSyncInput>): CalendarSyncInput {
  return { workouts: [], today: TODAY, existing: [], mapping: {}, ...OPTS, ...overrides };
}

function existing(id: string, workoutId: string, date: string): ExistingEvent {
  return { id, url: `${LINK}workout/${workoutId}`, startDate: new Date(`${date}T10:00:00`) };
}

function signatureOf(w: Workout, opts = OPTS): string {
  return eventSignature(eventDetails(w, opts));
}

describe('profile time zone', () => {
  test('wall time in the profile zone becomes the right instant (DST aware)', () => {
    expect(zonedDateTime('2026-10-27', 18 * 60 + 30, 'UTC').toISOString()).toBe('2026-10-27T18:30:00.000Z');
    // Madrid: CET (UTC+1) after 25 Oct 2026, CEST (UTC+2) before.
    expect(zonedDateTime('2026-10-27', 7 * 60, 'Europe/Madrid').toISOString()).toBe('2026-10-27T06:00:00.000Z');
    expect(zonedDateTime('2026-10-20', 7 * 60, 'Europe/Madrid').toISOString()).toBe('2026-10-20T05:00:00.000Z');
    expect(zonedDateTime('2026-07-01', 6 * 60, 'America/New_York').toISOString()).toBe('2026-07-01T10:00:00.000Z');
  });

  test('unknown or missing zones fall back to the device local time', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(zonedDateTime('2026-10-27', 60, 'Mars/Olympus')).toEqual(new Date(2026, 9, 27, 1, 0));
    expect(zonedDateTime('2026-10-27', 60, null)).toEqual(new Date(2026, 9, 27, 1, 0));
  });
});

describe('training event details', () => {
  test('title: sport emoji, title and duration; done workouts get a tick', () => {
    expect(eventTitle(workout({ id: 'a', date: TODAY, title: 'Rodaje suave', durationMin: 50 }))).toBe("🏃 Rodaje suave · 50'");
    expect(eventTitle(workout({ id: 'b', date: TODAY, sport: 'swim', title: 'Técnica', durationMin: 75 }))).toBe("🏊 Técnica · 1h 15'");
    expect(eventTitle(workout({ id: 'c', date: TODAY, sport: 'brick', title: 'Transición', status: 'completed' }))).toBe("🔁 Transición · 50' ✓");
    expect(eventTitle(workout({ id: 'd', date: TODAY, sport: 'strength', title: 'Fuerza' }))).toMatch(/^🏋️ /);
    expect(eventTitle(workout({ id: 'e', date: TODAY, sport: 'mobility', title: 'Movilidad' }))).toMatch(/^🧘 /);
    expect(eventTitle(workout({ id: 'f', date: TODAY, sport: 'bike', title: 'Rodillo' }))).toMatch(/^🚴 /);
  });

  test('notes: intensity, structure and the deep link', () => {
    const w = workout({
      id: 'w1',
      date: TODAY,
      title: 'Series',
      intensity: 'threshold',
      durationMin: 60,
      distanceM: 10_000,
      description: 'Ritmo controlado',
      steps: [
        { kind: 'warmup', durationMin: 15 },
        { kind: 'work', durationMin: 4, repeat: 6, intensity: 'threshold', note: 'cadencia alta' },
        { kind: 'cooldown', durationMin: 10 },
      ],
    });
    const notes = eventNotes(w, `${LINK}workout/w1`);
    expect(notes.split('\n')).toEqual([
      "Carrera · Umbral Z4 · 1h · 10 km",
      '',
      'Ritmo controlado',
      '',
      'Estructura:',
      "• 15' · Calentamiento",
      "• 6× 4' · Trabajo (Umbral Z4) — cadencia alta",
      "• 10' · Vuelta a la calma",
      '',
      'Abrir en la app: roadtoironman://workout/w1',
    ]);
  });

  test('timed workouts: start in the profile zone, end after the duration, alarm before', () => {
    const details = eventDetails(workout({ id: 'w1', date: TODAY, startTime: '18:30', durationMin: 50 }), OPTS);
    expect(details.allDay).toBe(false);
    expect(details.startDate.toISOString()).toBe('2026-10-27T17:30:00.000Z');
    expect(details.endDate.toISOString()).toBe('2026-10-27T18:20:00.000Z');
    expect(details.alarms).toEqual([{ relativeOffset: -30 }]);
    expect(details.timeZone).toBe('Europe/Madrid');
    expect(details.url).toBe('roadtoironman://workout/w1');
  });

  test('untimed workouts are all-day events without alarm (the briefing covers them)', () => {
    const details = eventDetails(workout({ id: 'w1', date: TODAY, startTime: null }), OPTS);
    expect(details.allDay).toBe(true);
    expect(details.startDate).toEqual(new Date(2026, 9, 27, 0, 0));
    expect(details.alarms).toEqual([]);
    expect(details.timeZone).toBeUndefined();
  });

  test('alarm 0 means no alarm; the signature changes with what is written', () => {
    const w = workout({ id: 'w1', date: TODAY, startTime: '07:00' });
    expect(eventDetails(w, { ...OPTS, alarmMinutes: 0 }).alarms).toEqual([]);
    expect(signatureOf(w)).toBe(signatureOf({ ...w }));
    expect(signatureOf(w)).not.toBe(signatureOf(w, { ...OPTS, alarmMinutes: 10 }));
    expect(signatureOf(w)).not.toBe(signatureOf({ ...w, title: 'Otro' }));
    expect(signatureOf(w)).not.toBe(signatureOf({ ...w, startTime: '07:30' }));
  });

  test('our event URLs are recognised with any scheme', () => {
    expect(workoutIdFromUrl('roadtoironman://workout/abc-123')).toBe('abc-123');
    expect(workoutIdFromUrl('rebufo://workout/abc')).toBe('abc');
    expect(workoutIdFromUrl('https://example.com/workout/abc/extra')).toBeNull();
    expect(workoutIdFromUrl(undefined)).toBeNull();
  });
});

describe('calendar sync plan', () => {
  test('window is [today − 1, today + 21]', () => {
    expect(trainingCalendarWindow(TODAY)).toEqual({ from: '2026-10-26', to: '2026-11-17' });
  });

  test('creates events for planned sessions in the window only (no rest days, nothing outside)', () => {
    const plan = planCalendarSync(
      input({
        workouts: [
          workout({ id: 'yesterday', date: '2026-10-26' }),
          workout({ id: 'old', date: '2026-10-25' }),
          workout({ id: 'last', date: '2026-11-17' }),
          workout({ id: 'far', date: '2026-11-18' }),
          workout({ id: 'rest', date: TODAY, sport: 'rest', title: 'Descanso' }),
          workout({ id: 'skipped', date: TODAY, status: 'skipped' }),
          workout({ id: 'done', date: TODAY, status: 'completed' }),
        ],
      }),
    );
    expect(plan.creates.map((c) => c.workoutId)).toEqual(['yesterday', 'last']);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  test('unchanged events are left alone; changed ones are updated', () => {
    const same = workout({ id: 'same', date: TODAY, startTime: '07:00' });
    const moved = workout({ id: 'moved', date: '2026-10-28', startTime: '19:00' });
    const plan = planCalendarSync(
      input({
        workouts: [same, moved],
        existing: [existing('e1', 'same', TODAY), existing('e2', 'moved', TODAY)],
        mapping: {
          same: { eventId: 'e1', signature: signatureOf(same) },
          moved: { eventId: 'e2', signature: 'stale' },
        },
      }),
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.updates.map((u) => [u.workoutId, u.eventId])).toEqual([['moved', 'e2']]);
    expect(plan.mapping).toEqual({
      same: { eventId: 'e1', signature: signatureOf(same) },
      moved: { eventId: 'e2', signature: signatureOf(moved) },
    });
  });

  test('a vanished event is recreated; an event found by URL (mapping lost) is rewritten once', () => {
    const a = workout({ id: 'a', date: TODAY });
    const b = workout({ id: 'b', date: TODAY });
    const plan = planCalendarSync(
      input({
        workouts: [a, b],
        existing: [existing('e-b', 'b', TODAY)],
        mapping: { a: { eventId: 'gone', signature: signatureOf(a) } },
      }),
    );
    expect(plan.creates.map((c) => c.workoutId)).toEqual(['a']);
    expect(plan.updates.map((u) => u.eventId)).toEqual(['e-b']);
  });

  test('skipped, deleted and moved-away workouts lose their events; history and foreign events stay', () => {
    const plan = planCalendarSync(
      input({
        workouts: [
          workout({ id: 'skipped', date: TODAY, status: 'skipped' }),
          workout({ id: 'moved', date: '2026-12-01' }),
          workout({ id: 'past', date: '2026-10-20' }),
        ],
        existing: [
          existing('e-skipped', 'skipped', TODAY),
          existing('e-deleted', 'deleted', '2026-10-29'),
          existing('e-moved', 'moved', '2026-10-30'),
          existing('e-history', 'history', '2026-10-24'),
          { id: 'mine', url: 'https://example.com', startDate: new Date('2026-10-28T10:00:00') },
          { id: 'no-url', startDate: new Date('2026-10-28T12:00:00') },
        ],
      }),
    );
    expect([...plan.deletes].sort()).toEqual(['e-deleted', 'e-moved', 'e-skipped']);
    expect(plan.creates).toEqual([]);
  });

  test('completed workouts keep (and tick) an existing event but never get a new one', () => {
    const done = workout({ id: 'done', date: TODAY, status: 'completed' });
    const doneNoEvent = workout({ id: 'done2', date: TODAY, status: 'completed' });
    const plan = planCalendarSync(input({ workouts: [done, doneNoEvent], existing: [existing('e1', 'done', TODAY)] }));
    expect(plan.updates.map((u) => [u.workoutId, u.details.title])).toEqual([['done', "🏃 Rodaje Z2 · 50' ✓"]]);
    expect(plan.creates).toEqual([]);
  });

  test('duplicate events of one workout are collapsed (mapped one kept)', () => {
    const w = workout({ id: 'w', date: TODAY });
    const plan = planCalendarSync(
      input({
        workouts: [w],
        existing: [existing('dup', 'w', TODAY), existing('main', 'w', TODAY)],
        mapping: { w: { eventId: 'main', signature: signatureOf(w) } },
      }),
    );
    expect(plan.deletes).toEqual(['dup']);
    expect(plan.unchanged).toBe(1);
    expect(plan.mapping.w?.eventId).toBe('main');
  });
});
