/**
 * syncWorkoutsToCalendar against an in-memory EventKit (fake expo-calendar object API):
 * creates our calendar on iCloud, writes only what changed, recreates vanished events,
 * removes skipped ones, never adopts or deletes a user's calendar, cleans up on sign-out —
 * and the busy-time reader never sees our calendar.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { listDeviceCalendars } from '../calendar';
import { syncWorkoutsToCalendar } from '../calendar/trainingCalendar';
import { getTrainingCalendarSnapshot, refreshTrainingCalendarState, resetTrainingCalendarState } from '../calendar/trainingCalendarState';
import {
  DEFAULT_TRAINING_SETTINGS,
  readTrainingSettings,
  trainingSettingsUserIds,
  writeTrainingSettings,
} from '../calendar/trainingCalendarStore';
import { clearTrainingCalendarData, turnOffTrainingCalendar } from '../calendar/trainingCalendarSync';
import { workout } from './fixtures';

interface FakeEventRecord {
  id: string;
  calendarId: string;
  title: string;
  startDate: Date;
  endDate: Date;
  url?: string;
  alarms?: { relativeOffset: number }[];
  allDay?: boolean;
}

interface FakeKit {
  calendars: { id: string; title: string; source: { id: string; name: string } }[];
  events: FakeEventRecord[];
  writes: number;
  createdIn: string[];
  reset(): void;
  addCalendar(id: string, title: string): void;
  addEvent(record: Omit<FakeEventRecord, 'endDate'>): void;
}

jest.mock('expo-calendar', () => {
  const kit = {
    calendars: [] as unknown[],
    events: [] as unknown[],
    writes: 0,
    createdIn: [] as string[],
    next: 1,
    reset() {
      kit.calendars = [];
      kit.events = [];
      kit.writes = 0;
      kit.createdIn = [];
      kit.next = 1;
    },
    addCalendar(id: string, title: string) {
      kit.calendars.push(new FakeCalendar(id, title, { id: 'src-icloud', name: 'iCloud' }));
    },
    addEvent(record: Record<string, unknown>) {
      kit.events.push(new FakeEvent({ endDate: record.startDate, ...record }));
    },
  };
  class FakeEvent {
    constructor(record: Record<string, unknown>) {
      Object.assign(this, record);
    }
    async update(details: Record<string, unknown>) {
      kit.writes += 1;
      Object.assign(this, details);
    }
    async delete() {
      kit.writes += 1;
      kit.events = kit.events.filter((e) => e !== this);
    }
  }
  class FakeCalendar {
    id: string;
    title: string;
    source: { id: string; name: string };
    allowsModifications = true;
    color = '#000000';
    constructor(id: string, title: string, source: { id: string; name: string }) {
      this.id = id;
      this.title = title;
      this.source = source;
    }
    async listEvents(start: Date, end: Date) {
      return (kit.events as (FakeEvent & { calendarId: string; startDate: Date })[]).filter(
        (e) => e.calendarId === this.id && e.startDate >= start && e.startDate < end,
      );
    }
    async createEvent(details: Record<string, unknown>) {
      kit.writes += 1;
      const event = new FakeEvent({ ...details, id: `ev${kit.next++}`, calendarId: this.id });
      kit.events.push(event);
      return event;
    }
    async delete() {
      // EventKit deletes a calendar together with its events.
      kit.calendars = kit.calendars.filter((c) => c !== this);
      kit.events = (kit.events as { calendarId: string }[]).filter((e) => e.calendarId !== this.id);
    }
    static async get(id: string) {
      const found = (kit.calendars as FakeCalendar[]).find((c) => c.id === id);
      if (!found) throw new Error('not found');
      return found;
    }
  }
  const sources = [
    { id: 'src-gmail', name: 'Gmail', type: 'caldav' },
    { id: 'src-icloud', name: 'iCloud', type: 'caldav' },
    { id: 'src-local', name: 'Default', type: 'local' },
  ];
  return {
    kit,
    ExpoCalendar: FakeCalendar,
    EntityTypes: { EVENT: 'event' },
    SourceType: { LOCAL: 'local' },
    getCalendarPermissions: async () => ({ status: 'granted' }),
    requestCalendarPermissions: async () => ({ status: 'granted' }),
    getCalendars: async () => kit.calendars,
    getSourcesSync: () => sources,
    getDefaultCalendarSync: () => ({ source: sources[0] }),
    createCalendar: async (details: { title: string; sourceId?: string }) => {
      const source = sources.find((s) => s.id === details.sourceId) ?? sources[0];
      kit.createdIn.push(source?.id ?? '');
      const calendar = new FakeCalendar(`cal${kit.next++}`, details.title, source ?? sources[0]!);
      kit.calendars.push(calendar);
      return calendar;
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const { kit } = jest.requireMock<{ kit: FakeKit }>('expo-calendar');

const USER = 'user-ana';
const TODAY = '2026-10-27';
const CONTEXT = { userId: USER, timeZone: 'Europe/Madrid' };

async function enableFor(userId: string): Promise<void> {
  await writeTrainingSettings(userId, { ...DEFAULT_TRAINING_SETTINGS, enabled: true });
}

beforeEach(async () => {
  kit.reset();
  resetTrainingCalendarState();
  await AsyncStorage.clear();
});

const at = (hour: number) => new Date(2026, 9, 27, hour, 0);
const eventsIn = (calendarId: string) => kit.events.filter((e) => e.calendarId === calendarId).map((e) => e.id);

describe('syncWorkoutsToCalendar (iOS)', () => {
  test('runs on iOS in this test environment', () => {
    expect(Platform.OS).toBe('ios');
  });

  test('does nothing until the account turns it on', async () => {
    const result = await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(kit.calendars).toHaveLength(0);
  });

  test('creates the calendar on iCloud and one event per planned workout, with alarm and link', async () => {
    await enableFor(USER);
    const workouts = [
      workout({ id: 'w1', date: TODAY, userId: USER, startTime: '18:30', title: 'Rodaje suave', durationMin: 50 }),
      workout({ id: 'w2', date: '2026-10-28', userId: USER, startTime: null, sport: 'swim', title: 'Técnica' }),
      workout({ id: 'rest', date: '2026-10-29', userId: USER, sport: 'rest', title: 'Descanso' }),
    ];
    const result = await syncWorkoutsToCalendar(workouts, TODAY, CONTEXT);

    expect(result).toEqual({ created: 2, updated: 0, deleted: 0 });
    expect(kit.createdIn).toEqual(['src-icloud']);
    expect(kit.calendars.map((c) => c.title)).toEqual(['Road to Ironman']);
    const timed = kit.events.find((e) => e.url === 'roadtoironman://workout/w1');
    expect(timed).toEqual(
      expect.objectContaining({ title: "🏃 Rodaje suave · 50'", alarms: [{ relativeOffset: -30 }], allDay: false }),
    );
    expect(timed?.startDate.toISOString()).toBe('2026-10-27T17:30:00.000Z');
    expect(kit.events.find((e) => e.url === 'roadtoironman://workout/w2')?.allDay).toBe(true);

    const settings = await readTrainingSettings(USER);
    expect(Object.keys(settings.events).sort()).toEqual(['w1', 'w2']);
    expect(settings.lastSync).not.toBeNull();
  });

  test('only writes what changed, recreates vanished events and removes skipped ones', async () => {
    await enableFor(USER);
    const w1 = workout({ id: 'w1', date: TODAY, userId: USER, startTime: '07:00' });
    const w2 = workout({ id: 'w2', date: '2026-10-30', userId: USER, startTime: '19:00' });
    await syncWorkoutsToCalendar([w1, w2], TODAY, CONTEXT);
    const writesAfterFirst = kit.writes;

    expect(await syncWorkoutsToCalendar([w1, w2], TODAY, CONTEXT)).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(kit.writes).toBe(writesAfterFirst);

    expect(await syncWorkoutsToCalendar([{ ...w1, startTime: '08:00' }, w2], TODAY, CONTEXT)).toEqual({
      created: 0,
      updated: 1,
      deleted: 0,
    });

    kit.events = kit.events.filter((e) => e.url !== 'roadtoironman://workout/w2');
    expect(await syncWorkoutsToCalendar([{ ...w1, startTime: '08:00' }, w2], TODAY, CONTEXT)).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
    });

    expect(
      await syncWorkoutsToCalendar([{ ...w1, startTime: '08:00', status: 'skipped' }, w2], TODAY, CONTEXT),
    ).toEqual({ created: 0, updated: 0, deleted: 1 });
    expect(kit.events.map((e) => e.url)).toEqual(['roadtoironman://workout/w2']);
  });

  test('reuses the existing calendar instead of creating a second one', async () => {
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    await enableFor('user-bea');
    await syncWorkoutsToCalendar([workout({ id: 'b1', date: TODAY, userId: 'user-bea' })], TODAY, { userId: 'user-bea' });
    expect(kit.calendars).toHaveLength(1);
  });

  test('our calendar never shows up among the calendars read as busy time', async () => {
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    const ours = kit.calendars[0];
    if (ours) ours.title = 'Entrenos (renombrado)';
    kit.calendars.push({ id: 'work', title: 'Trabajo', source: { id: 'src-icloud', name: 'iCloud' } } as never);

    const listed = await listDeviceCalendars();
    expect(listed.map((c) => c.title)).toEqual(['Trabajo']);
  });

  test('the shared state lists the workouts that currently have an event', async () => {
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    await refreshTrainingCalendarState(USER);
    expect(getTrainingCalendarSnapshot()).toEqual(expect.objectContaining({ userId: USER, enabled: true, syncedWorkoutIds: ['w1'] }));
  });
});

describe("a user's own calendars are never at risk", () => {
  test("a same-titled calendar with someone else's events is not adopted (we create our own)", async () => {
    kit.addCalendar('user-cal', 'Road to Ironman');
    kit.addEvent({ id: 'dinner', calendarId: 'user-cal', title: 'Cena', startDate: at(21) });
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);

    expect(kit.calendars.map((c) => c.id)).toEqual(['user-cal', expect.stringMatching(/^cal/)]);
    expect(eventsIn('user-cal')).toEqual(['dinner']);
    expect((await readTrainingSettings(USER)).createdByApp).toBe(true);

    await turnOffTrainingCalendar(USER, true);
    expect(kit.calendars.map((c) => c.id)).toEqual(['user-cal']);
    expect(eventsIn('user-cal')).toEqual(['dinner']);
  });

  test('a same-titled calendar holding only our events is reused but never deleted', async () => {
    kit.addCalendar('old', 'Road to Ironman');
    kit.addEvent({ id: 'o1', calendarId: 'old', title: '🏃 Viejo', startDate: at(8), url: 'roadtoironman://workout/w9' });
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    expect(kit.calendars.map((c) => c.id)).toEqual(['old']);
    expect((await readTrainingSettings(USER)).createdByApp).toBe(false);

    await turnOffTrainingCalendar(USER, true);
    expect(kit.calendars.map((c) => c.id)).toEqual(['old']);
    expect(eventsIn('old')).toEqual([]);
  });

  test('our own calendar survives when the user added events to it; only ours are removed', async () => {
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    const ours = kit.calendars[0]?.id ?? '';
    kit.addEvent({ id: 'mine', calendarId: ours, title: 'Fisio', startDate: at(17) });

    await turnOffTrainingCalendar(USER, true);
    expect(kit.calendars.map((c) => c.id)).toEqual([ours]);
    expect(eventsIn(ours)).toEqual(['mine']);
  });

  test('switching off without removing keeps every event', async () => {
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    await turnOffTrainingCalendar(USER, false);
    expect(kit.events).toHaveLength(1);
    expect((await readTrainingSettings(USER)).enabled).toBe(false);
  });
});

describe('sign-out cleanup', () => {
  test("removes the account's events, our empty calendar and its settings", async () => {
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);
    expect(kit.calendars).toHaveLength(1);

    await clearTrainingCalendarData(USER);
    expect(kit.calendars).toHaveLength(0);
    expect(await trainingSettingsUserIds()).toEqual([]);
  });

  test("an unknown signed-out account: every account's leftovers go, user events stay", async () => {
    kit.addCalendar('user-cal', 'Trabajo');
    kit.addEvent({ id: 'meeting', calendarId: 'user-cal', title: 'Reunión', startDate: at(10) });
    await enableFor(USER);
    await syncWorkoutsToCalendar([workout({ id: 'w1', date: TODAY, userId: USER })], TODAY, CONTEXT);

    await clearTrainingCalendarData(null);
    expect(kit.calendars.map((c) => c.id)).toEqual(['user-cal']);
    expect(kit.events.map((e) => e.id)).toEqual(['meeting']);
    expect(await trainingSettingsUserIds()).toEqual([]);
  });
});
