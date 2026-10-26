/**
 * Renders the real widget layouts (the 'widget' functions that babel-preset-expo
 * serialises for the WidgetKit runtime) against fake SwiftUI primitives, so we
 * can assert on the root view of every family the app config declares.
 *
 * iOS 17+ replaces a widget whose root has no `containerBackground` with the
 * "Please adopt containerBackground API" placeholder.
 */
import { describe, expect, jest, test } from '@jest/globals';

import type { NextWorkoutWidgetProps } from '../widgets/NextWorkoutWidget';
import type { RaceWidgetProps } from '../widgets/RaceWidget';
import type { TodayWidgetProps } from '../widgets/TodayWidget';

jest.mock('expo-widgets', () => ({
  createWidget: (name: string, layout: unknown, initialProps: unknown) => ({ name, layout, initialProps }),
}));
jest.mock('@expo/ui/swift-ui', () => ({}));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({}));

interface FakeModifier {
  modifier: string;
  args: unknown[];
}

interface FakeElement {
  type: string;
  props: { modifiers?: FakeModifier[]; [key: string]: unknown };
}

type Layout = (props: unknown, environment: { widgetFamily: string; colorScheme: string }) => FakeElement;

/**
 * Identifiers the serialised layout references resolve to fakes: `_jsx`/`_jsxs`
 * build plain elements, capitalised names are components, the rest modifiers.
 */
const scope = new Proxy({} as Record<string, unknown>, {
  has: (_target, key) => typeof key === 'string' && !(key in globalThis),
  get: (_target, key) => {
    if (typeof key !== 'string') return undefined;
    if (key === '_jsx' || key === '_jsxs') return (type: string, props: FakeElement['props']) => ({ type, props });
    if (/^[A-Z]/.test(key)) return key;
    return (...args: unknown[]): FakeModifier => ({ modifier: key, args });
  },
});

function loadLayout(modulePath: string): Layout {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const widget = (require(modulePath) as { default: { layout: unknown } }).default;
  if (typeof widget.layout !== 'string') throw new Error('expected a serialised widget layout');
  // Sloppy-mode Function so `with` can route free identifiers to the fake scope.
  // eslint-disable-next-line no-new-func
  const factory = new Function('scope', `with (scope) { return (${widget.layout}); }`) as (s: unknown) => Layout;
  return factory(scope);
}

function containerBackgroundOf(element: FakeElement): FakeModifier | undefined {
  return element.props.modifiers?.find((m) => m.modifier === 'containerBackground');
}

const nextItem = { id: 'w1', title: 'Series 6x1000', sport: 'run', sportLabel: 'Carrera', when: 'Hoy 18:30', duration: "50'", partner: '' };

const nextVariants: NextWorkoutWidgetProps[] = [
  { next: nextItem, linkBase: 'roadtoironman://' },
  { next: null, linkBase: 'roadtoironman://' },
];

const raceVariants: RaceWidgetProps[] = [
  { raceName: 'Media de Valencia', daysToRace: 12, raceDateLabel: 'dom 8 nov', distanceLabel: 'Media distancia', weekPercent: 40, weekLabel: "2h de 5h", linkBase: 'roadtoironman://' },
  { raceName: 'Media de Valencia', daysToRace: 0, raceDateLabel: 'dom 8 nov', distanceLabel: 'Media distancia', weekPercent: 0, weekLabel: '', linkBase: 'roadtoironman://' },
  { raceName: null, daysToRace: null, raceDateLabel: '', distanceLabel: '', weekPercent: 0, weekLabel: '', linkBase: 'roadtoironman://' },
];

const todayVariants: TodayWidgetProps[] = [
  {
    dateLabel: 'lun 26 oct',
    today: [{ ...nextItem, time: '18:30', done: false }],
    tomorrow: [],
    next: { ...nextItem, time: '18:30', done: false },
    allDoneToday: false,
    week: [{ letter: 'L', day: '26', isToday: true, sports: ['run'], done: false }],
    weekPercent: 20,
    weekSummary: '0/1 sesiones',
    linkBase: 'roadtoironman://',
  },
  { dateLabel: '', today: [], tomorrow: [], next: null, allDoneToday: false, week: [], weekPercent: 0, weekSummary: '', linkBase: 'roadtoironman://' },
];

const cases: { name: string; module: string; families: string[]; variants: unknown[]; lockScreen: string[] }[] = [
  { name: 'NextWorkoutWidget', module: '../widgets/NextWorkoutWidget', families: ['accessoryRectangular', 'accessoryInline'], variants: nextVariants, lockScreen: ['accessoryRectangular', 'accessoryInline'] },
  { name: 'RaceWidget', module: '../widgets/RaceWidget', families: ['systemSmall', 'accessoryCircular', 'accessoryInline'], variants: raceVariants, lockScreen: ['accessoryCircular', 'accessoryInline'] },
  { name: 'TodayWidget', module: '../widgets/TodayWidget', families: ['systemSmall', 'systemMedium', 'systemLarge'], variants: todayVariants, lockScreen: [] },
];

describe.each(cases)('$name', ({ module, families, variants, lockScreen }) => {
  const layout = loadLayout(module);

  test.each(families)('the %s root always sets containerBackground for the widget', (family) => {
    for (const colorScheme of ['light', 'dark']) {
      for (const props of variants) {
        const root = layout(props, { widgetFamily: family, colorScheme });
        const background = containerBackgroundOf(root);
        expect(background).toBeDefined();
        expect(background?.args[1]).toBe('widget');
        if (lockScreen.includes(family)) expect(background?.args[0]).toBe('clear');
      }
    }
  });

  test.each(families)('the %s root keeps its deep link', (family) => {
    for (const props of variants) {
      const root = layout(props, { widgetFamily: family, colorScheme: 'light' });
      expect(root.props.modifiers?.some((m) => m.modifier === 'widgetURL')).toBe(true);
    }
  });
});
