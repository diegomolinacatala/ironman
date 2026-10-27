import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { todayISO } from '@/domain/dates';

import { workout } from './fixtures';

/**
 * expo-widgets stores widget props in the App Group's UserDefaults, which only accepts property
 * lists: a JS `null` arrives as NSNull and UserDefaults throws. In build 4 that happened inside
 * `createWidget` while `sync.ios.ts` was being imported, and the app closed on launch.
 * The fake below rejects what UserDefaults rejects.
 */
function mockAssertPropertyList(value: unknown, path = 'props'): void {
  if (value === null || value === undefined) throw new Error(`non-property-list value at ${path}`);
  if (Array.isArray(value)) {
    value.forEach((item, i) => mockAssertPropertyList(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) mockAssertPropertyList(item, `${path}.${key}`);
    return;
  }
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`unsupported ${typeof value} at ${path}`);
}

interface FakeWidgets {
  created: string[];
  stored: unknown[];
}

jest.mock('@expo/ui/swift-ui', () => ({}));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({}));
// The widgets are created while `sync.ios` is imported (hoisted above this file's own constants),
// so the fake keeps its records itself.
jest.mock('expo-widgets', () => {
  const fake = { created: [] as string[], stored: [] as unknown[] };
  return {
    fake,
    createWidget: (name: string, _layout: unknown, initialProps: unknown) => {
      mockAssertPropertyList(initialProps, `${name}.initialProps`);
      fake.created.push(name);
      const store = (entries: unknown) => {
        mockAssertPropertyList(entries, `${name}.timeline`);
        fake.stored.push(entries);
      };
      return {
        updateTimeline: (entries: { date: Date; props: unknown }[]) => store(entries.map((e) => e.props)),
        updateSnapshot: (props: unknown) => store([props]),
      };
    },
  };
});

// Imported after the mocks: creating the widgets at import time is what crashed.
// eslint-disable-next-line import/first
import { clearWidgets, resetWidgetCache, syncWidgets } from '../widgets/sync.ios';

const { fake } = jest.requireMock<{ fake: FakeWidgets }>('expo-widgets');
const mockCreated = fake.created;
const mockStored = fake.stored;

describe('widget sync on iOS', () => {
  beforeEach(() => {
    mockStored.length = 0;
    resetWidgetCache();
  });

  test('creates the four widgets with property-list initial props', () => {
    expect([...mockCreated].sort()).toEqual(['BriefingWidget', 'NextWorkoutWidget', 'RaceWidget', 'TodayWidget']);
  });

  test('clearing the widgets (signed out) stores only property lists', () => {
    clearWidgets();

    expect(mockStored).toHaveLength(4);
  });

  test('syncing an empty plan (no race, nothing next, no briefing) stores only property lists', () => {
    syncWidgets({ workouts: [], races: [], jointSessions: [], profile: null, today: '2026-10-26', briefing: null });

    expect(mockStored).toHaveLength(4);
  });

  test("the briefing widget gets today's headline as strings, twice (now + next midnight)", () => {
    syncWidgets({
      workouts: [],
      races: [],
      jointSessions: [],
      profile: null,
      today: '2026-10-26',
      briefing: { date: '2026-10-26', headline: 'Has dormido bien: hoy toca rodaje suave' },
    });

    const briefingTimeline = mockStored[3] as { date: string; headline: string; linkBase: string }[];
    expect(briefingTimeline).toHaveLength(2);
    expect(briefingTimeline[0]).toEqual({
      date: '2026-10-26',
      headline: 'Has dormido bien: hoy toca rodaje suave',
      linkBase: expect.stringMatching(/^[a-z]+:\/\/$/),
    });
  });

  test('an unchanged plan does not reload the widgets again', () => {
    // Real "today": the timeline's first entry is "now", which must come before the next midnight.
    const input = { workouts: [], races: [], jointSessions: [], profile: null, today: todayISO(), briefing: null };
    syncWidgets(input);
    syncWidgets(input);

    expect(mockStored).toHaveLength(4);
  });

  test('syncing a plan with sessions and a race stores only property lists', () => {
    syncWidgets({
      workouts: [workout({ id: 'w1', date: '2026-10-26', startTime: null }), workout({ id: 'w2', date: '2026-10-27' })],
      races: [
        {
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
        },
      ],
      jointSessions: [],
      profile: null,
      today: '2026-10-26',
      briefing: { date: '2026-10-26', headline: 'Duerme más esta noche' },
    });

    expect(mockStored).toHaveLength(4);
  });
});
