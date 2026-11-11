/**
 * Renders the real widget layouts (the 'widget' functions that babel-preset-expo
 * serialises for the WidgetKit runtime) against fake SwiftUI primitives, so we
 * can assert on the root view of every family the app config declares.
 *
 * iOS 17+ replaces a widget whose root has no `containerBackground` with the
 * "Please adopt containerBackground API" placeholder.
 */
import { describe, expect, jest, test } from '@jest/globals';

import type { BriefingWidgetProps } from '../widgets/BriefingWidget';
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

type Layout = (props: unknown, environment: { widgetFamily: string; colorScheme: string; date?: Date }) => FakeElement;

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

const nextItem = {
  id: 'w1',
  title: 'Series 6x1000',
  sport: 'run',
  sportLabel: 'Carrera',
  when: 'Hoy 18:30',
  duration: "50'",
  partner: '',
  target: 'Z4 · 162–168 ppm',
};

const nextVariants: NextWorkoutWidgetProps[] = [
  { next: nextItem, linkBase: 'roadtoironman://' },
  { next: { ...nextItem, target: '' }, linkBase: 'roadtoironman://' },
  { next: { ...nextItem, partner: 'con Álex' }, linkBase: 'roadtoironman://' },
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

const briefingVariants: (BriefingWidgetProps | { linkBase: string })[] = [
  { date: '2026-10-27', headline: 'Has dormido bien: hoy toca rodaje suave', linkBase: 'roadtoironman://' },
  { date: '', headline: '', linkBase: 'roadtoironman://' },
  // What reaches the widget once plist.ts dropped empty values.
  { linkBase: 'roadtoironman://' },
];

const cases: { name: string; module: string; families: string[]; variants: unknown[]; lockScreen: string[] }[] = [
  {
    name: 'BriefingWidget',
    module: '../widgets/BriefingWidget',
    families: ['accessoryRectangular', 'accessoryCircular', 'accessoryInline', 'systemSmall'],
    variants: briefingVariants,
    lockScreen: ['accessoryRectangular', 'accessoryCircular', 'accessoryInline'],
  },
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

/** Every string rendered under `element` (Text children), depth first. */
function textsOf(element: unknown): string[] {
  if (typeof element === 'string') return [element];
  if (Array.isArray(element)) return element.flatMap(textsOf);
  if (element && typeof element === 'object' && 'props' in element) {
    return textsOf((element as FakeElement).props.children);
  }
  return [];
}

describe('session targets on the detail line', () => {
  test('the lock screen says duration and target (the symbol says the sport)', () => {
    const layout = loadLayout('../widgets/NextWorkoutWidget');
    const render = (props: NextWorkoutWidgetProps) => textsOf(layout(props, { widgetFamily: 'accessoryRectangular', colorScheme: 'light' }));
    expect(render(nextVariants[0]!)).toContain("50' · Z4 · 162–168 ppm");
    expect(render(nextVariants[1]!)).toContain("Carrera · 50'");
    expect(render(nextVariants[2]!)).toContain("50' · con Álex · Z4 · 162–168 ppm");
    // Stored by an older app version (no `target` key): reads as none.
    const legacy = Object.fromEntries(Object.entries(nextItem).filter(([key]) => key !== 'target')) as typeof nextItem;
    expect(render({ next: legacy, linkBase: 'roadtoironman://' })).toContain("Carrera · 50'");
  });

  test('Hoy rows add the target after time and duration; the small widget names it on its sport row', () => {
    const layout = loadLayout('../widgets/TodayWidget');
    const medium = textsOf(layout(todayVariants[0], { widgetFamily: 'systemMedium', colorScheme: 'light' }));
    expect(medium).toContain("18:30 · 50' · Z4 · 162–168 ppm");
    const small = textsOf(layout(todayVariants[0], { widgetFamily: 'systemSmall', colorScheme: 'light' }));
    expect(small).toContain('Z4 · 162–168 ppm');
    expect(small).not.toContain('Carrera');
    const noTarget = { ...todayVariants[0]!, next: { ...nextItem, time: '18:30', done: false, target: '' } };
    expect(textsOf(layout(noTarget, { widgetFamily: 'systemSmall', colorScheme: 'light' }))).toContain('Carrera');
  });
});

describe('BriefingWidget content', () => {
  const layout = loadLayout('../widgets/BriefingWidget');
  const headline = 'Has dormido bien: hoy toca rodaje suave';
  const props: BriefingWidgetProps = { date: '2026-10-27', headline, linkBase: 'roadtoironman://' };

  test('shows the headline on its own day and the call to action afterwards', () => {
    const sameDay = layout(props, { widgetFamily: 'accessoryInline', colorScheme: 'light', date: new Date(2026, 9, 27, 9, 0) });
    expect(sameDay.props.children).toBe(headline);
    const nextDay = layout(props, { widgetFamily: 'accessoryInline', colorScheme: 'light', date: new Date(2026, 9, 28, 0, 0) });
    expect(nextDay.props.children).toBe('Informe de hoy · escúchalo');
  });

  test('opens the briefing and plays it', () => {
    const root = layout(props, { widgetFamily: 'accessoryRectangular', colorScheme: 'light', date: new Date(2026, 9, 27, 9, 0) });
    const link = root.props.modifiers?.find((m) => m.modifier === 'widgetURL');
    expect(link?.args[0]).toBe('roadtoironman://briefing?play=1');
  });
});

describe('widget branding mirrors the app theme', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeTheme, sportColor } = require('@/ui/theme') as typeof import('@/ui/theme');
  const themeValues = [makeTheme(false), makeTheme(true)].flatMap((t) => Object.values(t.colors));
  const allowed = new Set(
    [...themeValues, ...Object.values(sportColor).map((s) => s.base)]
      .filter((v): v is string => typeof v === 'string' && v.startsWith('#'))
      .map((v) => v.toUpperCase()),
  );

  function sourceOf(modulePath: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require(modulePath) as { default: { layout: string } }).default.layout;
  }

  test.each(cases.map((c) => [c.name, c.module]))('%s only uses theme colours (no hi-vis lime)', (_name, module) => {
    const source = sourceOf(module);
    const hexes = source.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
    expect(source).not.toMatch(/D4FF3A/i);
    for (const hex of hexes) expect(allowed).toContain(hex.toUpperCase());
  });

  test.each(cases.map((c) => [c.name, c.module]))('%s has no italic, tracked or all-caps labels', (_name, module) => {
    const source = sourceOf(module);
    expect(source).not.toMatch(/italic\(|kerning\(|toUpperCase\(/);
  });

  test('the "Hoy" pill of the Today widget uses the soft brand tint in both schemes', () => {
    const layout = loadLayout('../widgets/TodayWidget');
    for (const isDark of [false, true]) {
      const { colors } = makeTheme(isDark);
      const root = layout(todayVariants[0], { widgetFamily: 'systemSmall', colorScheme: isDark ? 'dark' : 'light' });
      const json = JSON.stringify(root);
      expect(json).toContain(colors.accentSoft);
      expect(json).toContain(colors.onAccentSoft);
      expect(containerBackgroundOf(root)?.args[0]).toBe(colors.bg);
    }
  });
});
