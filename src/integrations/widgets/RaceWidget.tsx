/**
 * "Cuenta atrás" widget: days to the next race + weekly progress ring.
 * Families: systemSmall, accessoryCircular, accessoryInline.
 *
 * Every branch's root sets `containerBackground` (iOS 17+ shows the "Please
 * adopt containerBackground API" placeholder otherwise): paper on the home
 * screen, clear on the lock screen so vibrant rendering stays intact.
 *
 * Isolated widget runtime: everything is declared inside the function.
 */
import { AccessoryWidgetBackground, Gauge, HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  gaugeStyle,
  italic,
  kerning,
  lineLimit,
  minimumScaleFactor,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export interface RaceWidgetProps {
  /** null when there is no upcoming race. */
  raceName: string | null;
  daysToRace: number | null;
  /** "dom 15 mar" */
  raceDateLabel: string;
  /** "Media distancia" */
  distanceLabel: string;
  /** 0..100 completed minutes vs planned this week. */
  weekPercent: number;
  /** "4h 10' de 6h" */
  weekLabel: string;
  linkBase: string;
}

const RaceWidget = (props: RaceWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const ink = dark ? '#F2EFE8' : '#15171A';
  const paper = dark ? '#0D0F12' : '#F4F1EA';
  const muted = dark ? '#A3A6AD' : '#5E6066';
  const lime = '#D4FF3A';
  const hasRace = props.raceName !== null && props.daysToRace !== null;
  const days = props.daysToRace ?? 0;
  const daysText = days === 0 ? '¡HOY!' : `${days}`;
  const unit = days === 1 ? 'día' : 'días';
  const url = hasRace ? `${props.linkBase}today` : `${props.linkBase}races`;

  const lockScreen = [containerBackground('clear', 'widget'), widgetURL(url)];

  if (environment.widgetFamily === 'accessoryInline') {
    return (
      <Text modifiers={lockScreen}>
        {hasRace ? (days === 0 ? `Hoy compites: ${props.raceName}` : `${days} ${unit} · ${props.raceName}`) : 'Sin carrera a la vista'}
      </Text>
    );
  }

  if (environment.widgetFamily === 'accessoryCircular') {
    return (
      <ZStack modifiers={lockScreen}>
        <AccessoryWidgetBackground />
        {hasRace ? (
          <VStack spacing={0}>
            <Text modifiers={[font({ size: days > 99 ? 18 : 22, weight: 'heavy' }), minimumScaleFactor(0.6), lineLimit(1)]}>
              {days === 0 ? 'HOY' : `${days}`}
            </Text>
            <Text modifiers={[font({ size: 9, weight: 'semibold' })]}>{days === 0 ? 'CARRERA' : unit.toUpperCase()}</Text>
          </VStack>
        ) : (
          <Image systemName="flag.checkered" size={20} />
        )}
      </ZStack>
    );
  }

  // systemSmall
  if (!hasRace) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[containerBackground(paper, 'widget'), widgetURL(url)]}>
        <Text modifiers={[font({ size: 11, weight: 'heavy' }), kerning(1.2), foregroundStyle(muted)]}>CUENTA ATRÁS</Text>
        <Spacer />
        <Image systemName="flag.checkered" size={22} color={ink} />
        <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(ink)]}>Sin carrera a la vista</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(2)]}>Añade tu próximo objetivo</Text>
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={2} modifiers={[containerBackground(paper, 'widget'), widgetURL(url)]}>
      <Text modifiers={[font({ size: 11, weight: 'heavy' }), kerning(1.2), foregroundStyle(muted)]}>CUENTA ATRÁS</Text>
      <HStack alignment="lastTextBaseline" spacing={4}>
        <Text modifiers={[font({ size: 44, weight: 'heavy' }), italic(), foregroundStyle(ink), minimumScaleFactor(0.5), lineLimit(1)]}>
          {daysText}
        </Text>
        {days === 0 ? null : <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(muted)]}>{unit}</Text>}
      </HStack>
      <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(ink), lineLimit(2)]}>{props.raceName ?? ''}</Text>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{`${props.distanceLabel} · ${props.raceDateLabel}`}</Text>
      <Spacer />
      <HStack spacing={8}>
        <Gauge
          value={Math.max(0, Math.min(100, props.weekPercent))}
          min={0}
          max={100}
          modifiers={[gaugeStyle('circularCapacity'), tint(lime)]}
          currentValueLabel={<Text modifiers={[font({ size: 12, weight: 'heavy' })]}>{`${props.weekPercent}`}</Text>}
        />
        <VStack alignment="leading" spacing={0}>
          <Text modifiers={[font({ size: 11, weight: 'heavy' }), kerning(1), foregroundStyle(muted)]}>SEMANA</Text>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(ink), lineLimit(2)]}>{props.weekLabel}</Text>
        </VStack>
      </HStack>
    </VStack>
  );
};

export default createWidget<RaceWidgetProps>('RaceWidget', RaceWidget, {
  raceName: null,
  daysToRace: null,
  raceDateLabel: '',
  distanceLabel: '',
  weekPercent: 0,
  weekLabel: '',
  linkBase: 'rebufo://',
});
