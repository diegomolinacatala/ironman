/**
 * "Hoy" home-screen widget (systemSmall / systemMedium / systemLarge).
 *
 * Runs in the expo-widgets isolated runtime: no hooks, no app imports and NO
 * references to module-scope values — every colour/helper lives inside the
 * function. Data arrives only through props (see `widgets/props.ts`).
 *
 * Colours MIRROR `src/ui/theme.ts` ("calm endurance"): bg / text / textMuted / border,
 * accent (navy, sky in dark) for the week progress, accentSoft + onAccentSoft for "Hoy",
 * accentInk for quedadas, success for done and `sportColor[*].base` for sports. The widget
 * can't import them: keep both in sync (guarded by widgetLayouts.test.ts).
 */
import {
  Circle,
  Divider,
  HStack,
  Image,
  Link,
  ProgressView,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  type ImageProps,
} from '@expo/ui/swift-ui';
import {
  background,
  containerBackground,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { toPropertyList } from './plist';

type SymbolName = NonNullable<ImageProps['systemName']>;

export interface WidgetSessionItem {
  id: string;
  title: string;
  /** Sport key (swim, bike, run…) — colours/icons are resolved inside the widget. */
  sport: string;
  sportLabel: string;
  /** "18:30" or "" when untimed. */
  time: string;
  /** "50'" / "1h 15'". */
  duration: string;
  done: boolean;
  /** "con Álex" for quedadas, otherwise "". */
  partner: string;
  /** Zone + main target ("Z4 · 162–168 ppm"), '' when none or done. Never null (plist). */
  target: string;
}

export interface WidgetWeekDay {
  /** L M X J V S D */
  letter: string;
  /** Day of month, "27". */
  day: string;
  isToday: boolean;
  sports: string[];
  done: boolean;
}

export interface TodayWidgetProps {
  /** "lun 27 oct" */
  dateLabel: string;
  today: WidgetSessionItem[];
  tomorrow: WidgetSessionItem[];
  /** Next pending session of today (small widget hero). */
  next: WidgetSessionItem | null;
  allDoneToday: boolean;
  week: WidgetWeekDay[];
  /** 0..100 completed minutes vs planned this week. */
  weekPercent: number;
  /** "3/6 sesiones · 4h 10' de 6h" */
  weekSummary: string;
  /** "roadtoironman://" — see `linkBaseFor` in props.ts. */
  linkBase: string;
}

const TodayWidget = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const ink = dark ? '#ECEFF3' : '#121826';
  const paper = dark ? '#0E1116' : '#F6F5F1';
  const muted = dark ? '#A2AAB5' : '#555D6B';
  const faint = dark ? '#29313B' : '#E3E1DA';
  const accent = dark ? '#A9C1EE' : '#1F3A68';
  const accentInk = dark ? '#A9C1EE' : '#2A4E8C';
  const accentSoft = dark ? '#1B2638' : '#E5EBF5';
  const onAccentSoft = dark ? '#C9D8F5' : '#1F3A68';
  const success = dark ? '#3DBE7C' : '#187A47';
  const sportColors: Record<string, string> = {
    swim: '#2F80C9',
    bike: '#7B61D1',
    run: '#12928C',
    brick: '#B0529F',
    strength: '#5D6776',
    mobility: '#6A83C2',
    other: '#C95A87',
    rest: '#9AA1AB',
  };
  const sportSymbols: Record<string, SymbolName> = {
    swim: 'figure.pool.swim',
    bike: 'figure.outdoor.cycle',
    run: 'figure.run',
    brick: 'figure.mixed.cardio',
    strength: 'figure.strengthtraining.traditional',
    mobility: 'figure.flexibility',
    other: 'sportscourt',
    rest: 'bed.double',
  };
  const colorOf = (sport: string): string => sportColors[sport] ?? sportColors.rest;
  const symbolOf = (sport: string): SymbolName => sportSymbols[sport] ?? 'figure.mixed.cardio';
  const todayUrl = `${props.linkBase}today`;
  const workoutUrl = (id: string): string => `${props.linkBase}workout/${id}`;
  const meta = (s: WidgetSessionItem): string => (s.time ? `${s.time} · ${s.duration}` : s.duration);
  // Detail line of a row: "18:30 · 55' · con Álex · Z4 · 162–168 ppm" (a missing key reads as none).
  const detail = (s: WidgetSessionItem): string => [meta(s), s.partner, s.target].filter((part) => !!part).join(' · ');

  // Small labels: sentence case, semibold, muted (no all-caps, no tracking).
  const overline = (label: string, color: string) => (
    <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(color), lineLimit(1)]}>{label}</Text>
  );

  const todayPill = () => (
    <Text
      modifiers={[
        font({ size: 12, weight: 'semibold' }),
        foregroundStyle(onAccentSoft),
        padding({ horizontal: 7, vertical: 2 }),
        background(accentSoft),
        cornerRadius(7),
      ]}>
      Hoy
    </Text>
  );

  const restBlock = (subtitle: string) => (
    <VStack alignment="leading" spacing={2}>
      <Image systemName="bed.double" size={16} color={muted} />
      <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(ink)]}>Día de descanso</Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(2)]}>{subtitle}</Text>
    </VStack>
  );

  const row = (s: WidgetSessionItem) => (
    <Link key={s.id} destination={workoutUrl(s.id)}>
      <HStack spacing={6}>
        <RoundedRectangle cornerRadius={2} modifiers={[foregroundStyle(colorOf(s.sport)), frame({ width: 4, height: 30 })]} />
        <VStack alignment="leading" spacing={0}>
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(s.done ? muted : ink), lineLimit(1)]}>
            {s.done ? `✓ ${s.title}` : s.title}
          </Text>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{detail(s)}</Text>
        </VStack>
        <Spacer />
      </HStack>
    </Link>
  );

  const list = (items: WidgetSessionItem[], max: number, emptyText: string) =>
    items.length === 0 ? (
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{emptyText}</Text>
    ) : (
      <VStack alignment="leading" spacing={6}>
        {items.slice(0, max).map(row)}
        {items.length > max ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{`+${items.length - max} más`}</Text>
        ) : null}
      </VStack>
    );

  if (environment.widgetFamily === 'systemMedium') {
    return (
      <HStack alignment="top" spacing={12} modifiers={[containerBackground(paper, 'widget'), widgetURL(todayUrl)]}>
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack spacing={6}>
            {todayPill()}
            {overline(props.dateLabel, muted)}
          </HStack>
          {list(props.today, 3, 'Día de descanso')}
          <Spacer />
        </VStack>
        <Divider />
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {overline('Mañana', muted)}
          {list(props.tomorrow, 3, 'Día de descanso')}
          <Spacer />
        </VStack>
      </HStack>
    );
  }

  if (environment.widgetFamily === 'systemLarge') {
    const weekDay = (d: WidgetWeekDay) => (
      <VStack key={`${d.letter}${d.day}`} spacing={4} modifiers={[frame({ maxWidth: Infinity })]}>
        <Text
          modifiers={[
            font({ size: 11, weight: d.isToday ? 'bold' : 'medium' }),
            foregroundStyle(d.isToday ? onAccentSoft : muted),
            frame({ width: 22, height: 22 }),
            background(d.isToday ? accentSoft : paper),
            cornerRadius(11),
          ]}>
          {d.letter}
        </Text>
        <HStack spacing={2}>
          {d.sports.length === 0 ? (
            <Circle modifiers={[foregroundStyle(faint), frame({ width: 6, height: 6 })]} />
          ) : (
            d.sports.map((sport) => (
              <Circle key={sport} modifiers={[foregroundStyle(colorOf(sport)), frame({ width: 6, height: 6 })]} />
            ))
          )}
        </HStack>
        {d.done ? <Image systemName="checkmark.circle.fill" size={11} color={success} /> : <Spacer minLength={11} />}
      </VStack>
    );
    return (
      <VStack alignment="leading" spacing={10} modifiers={[containerBackground(paper, 'widget'), widgetURL(todayUrl)]}>
        <HStack spacing={6}>
          {todayPill()}
          {overline(props.dateLabel, muted)}
          <Spacer />
          <Text modifiers={[font({ size: 20, weight: 'semibold' }), foregroundStyle(ink)]}>{`${props.weekPercent}%`}</Text>
        </HStack>
        {list(props.today, 3, 'Día de descanso. Recupera bien.')}
        <Divider />
        {overline('Mañana', muted)}
        {list(props.tomorrow, 2, 'Día de descanso')}
        <Spacer />
        <HStack spacing={0}>{props.week.map(weekDay)}</HStack>
        <ProgressView value={props.weekPercent / 100} modifiers={[tint(accent)]} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{props.weekSummary}</Text>
      </VStack>
    );
  }

  // systemSmall (default): the next session, big. Its sport row names the target when there is one
  // (the coloured symbol already says the sport): no extra line in a small widget.
  const next = props.next;
  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[containerBackground(paper, 'widget'), widgetURL(next ? workoutUrl(next.id) : todayUrl)]}>
      <HStack spacing={6}>
        {todayPill()}
        <Spacer />
        {overline(props.dateLabel, muted)}
      </HStack>
      <Spacer />
      {next ? (
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={4}>
            <Image systemName={symbolOf(next.sport)} size={13} color={colorOf(next.sport)} />
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1)]}>
              {next.target ? next.target : next.sportLabel}
            </Text>
          </HStack>
          <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle(ink), lineLimit(2)]}>{next.title}</Text>
          <Text modifiers={[font({ size: 20, weight: 'semibold' }), foregroundStyle(ink), lineLimit(1)]}>{meta(next)}</Text>
          {next.partner ? (
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accentInk), lineLimit(1)]}>{next.partner}</Text>
          ) : null}
        </VStack>
      ) : props.allDoneToday ? (
        <VStack alignment="leading" spacing={2}>
          <Image systemName="checkmark.circle.fill" size={18} color={success} />
          <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle(ink)]}>Todo hecho</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>Buen trabajo hoy.</Text>
        </VStack>
      ) : (
        restBlock('Recupera bien: también es entreno.')
      )}
    </VStack>
  );
};

export default createWidget<TodayWidgetProps>(
  'TodayWidget',
  TodayWidget,
  toPropertyList({
    dateLabel: '',
    today: [],
    tomorrow: [],
    next: null,
    allDoneToday: false,
    week: [],
    weekPercent: 0,
    weekSummary: 'Abre Road to Ironman para cargar tu semana',
    linkBase: 'roadtoironman://',
  }),
);
