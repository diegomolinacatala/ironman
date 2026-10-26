/**
 * "Hoy" home-screen widget (systemSmall / systemMedium / systemLarge).
 *
 * Runs in the expo-widgets isolated runtime: no hooks, no app imports and NO
 * references to module-scope values — every colour/helper lives inside the
 * function. Data arrives only through props (see `widgets/props.ts`).
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
  italic,
  kerning,
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
  const ink = dark ? '#F2EFE8' : '#15171A';
  const paper = dark ? '#0D0F12' : '#F4F1EA';
  const muted = dark ? '#A3A6AD' : '#5E6066';
  const faint = dark ? '#2A2F37' : '#DCD6CA';
  const lime = '#D4FF3A';
  const limeInk = dark ? '#D4FF3A' : '#4B6B00';
  const sportColors: Record<string, string> = {
    swim: '#2F7BEA',
    bike: '#8A5CF6',
    run: '#0FA3A0',
    brick: '#C04FD0',
    strength: '#5B6474',
    mobility: '#6C8CD5',
    other: '#E0559B',
    rest: '#9AA0A6',
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
  const colorOf = (sport: string): string => sportColors[sport] ?? '#9AA0A6';
  const symbolOf = (sport: string): SymbolName => sportSymbols[sport] ?? 'figure.mixed.cardio';
  const todayUrl = `${props.linkBase}today`;
  const workoutUrl = (id: string): string => `${props.linkBase}workout/${id}`;
  const meta = (s: WidgetSessionItem): string => (s.time ? `${s.time} · ${s.duration}` : s.duration);

  const overline = (label: string, color: string) => (
    <Text modifiers={[font({ size: 11, weight: 'heavy' }), kerning(1.2), foregroundStyle(color)]}>{label}</Text>
  );

  const todayPill = () => (
    <Text
      modifiers={[
        font({ size: 11, weight: 'heavy' }),
        kerning(1.2),
        foregroundStyle('#15171A'),
        padding({ horizontal: 6, vertical: 2 }),
        background(lime),
        cornerRadius(6),
      ]}>
      HOY
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
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>
            {s.partner ? `${meta(s)} · ${s.partner}` : meta(s)}
          </Text>
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
            {overline(props.dateLabel.toUpperCase(), muted)}
          </HStack>
          {list(props.today, 3, 'Día de descanso')}
          <Spacer />
        </VStack>
        <Divider />
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {overline('MAÑANA', muted)}
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
            font({ size: 11, weight: 'heavy' }),
            foregroundStyle(d.isToday ? '#15171A' : muted),
            frame({ width: 22, height: 22 }),
            background(d.isToday ? lime : paper),
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
        {d.done ? <Image systemName="checkmark.circle.fill" size={11} color={limeInk} /> : <Spacer minLength={11} />}
      </VStack>
    );
    return (
      <VStack alignment="leading" spacing={10} modifiers={[containerBackground(paper, 'widget'), widgetURL(todayUrl)]}>
        <HStack spacing={6}>
          {todayPill()}
          {overline(props.dateLabel.toUpperCase(), muted)}
          <Spacer />
          <Text modifiers={[font({ size: 22, weight: 'heavy' }), italic(), foregroundStyle(ink)]}>{`${props.weekPercent}%`}</Text>
        </HStack>
        {list(props.today, 3, 'Día de descanso. Recupera bien.')}
        <Divider />
        {overline('MAÑANA', muted)}
        {list(props.tomorrow, 2, 'Día de descanso')}
        <Spacer />
        <HStack spacing={0}>{props.week.map(weekDay)}</HStack>
        <ProgressView value={props.weekPercent / 100} modifiers={[tint(lime)]} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{props.weekSummary}</Text>
      </VStack>
    );
  }

  // systemSmall (default): the next session, big.
  const next = props.next;
  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[containerBackground(paper, 'widget'), widgetURL(next ? workoutUrl(next.id) : todayUrl)]}>
      <HStack spacing={6}>
        {todayPill()}
        <Spacer />
        {overline(props.dateLabel.toUpperCase(), muted)}
      </HStack>
      <Spacer />
      {next ? (
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={4}>
            <Image systemName={symbolOf(next.sport)} size={13} color={colorOf(next.sport)} />
            <Text modifiers={[font({ size: 11, weight: 'heavy' }), kerning(1), foregroundStyle(colorOf(next.sport))]}>
              {next.sportLabel.toUpperCase()}
            </Text>
          </HStack>
          <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle(ink), lineLimit(2)]}>{next.title}</Text>
          <Text modifiers={[font({ size: 22, weight: 'heavy' }), italic(), foregroundStyle(ink), lineLimit(1)]}>{meta(next)}</Text>
          {next.partner ? (
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(limeInk), lineLimit(1)]}>{next.partner}</Text>
          ) : null}
        </VStack>
      ) : props.allDoneToday ? (
        <VStack alignment="leading" spacing={2}>
          <Image systemName="checkmark.circle.fill" size={18} color={limeInk} />
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
