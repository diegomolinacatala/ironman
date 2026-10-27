/**
 * "Informe de hoy" widget: lock screen (accessoryRectangular / Circular / Inline) and
 * home screen (systemSmall). A tap opens `/briefing?play=1`, which reads the morning
 * briefing aloud.
 *
 * Props are strings only ('' = none). The headline is shown only on the day it was written
 * (`props.date` equals the timeline entry's local date); otherwise the call to action.
 *
 * Every branch's root sets `containerBackground` (iOS 17+ shows the "Please adopt
 * containerBackground API" placeholder otherwise): clear on the lock screen so vibrant
 * rendering stays intact, paper on the home screen.
 *
 * Isolated widget runtime: everything is declared inside the function.
 */
import { AccessoryWidgetBackground, HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  kerning,
  lineLimit,
  minimumScaleFactor,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { toPropertyList } from './plist';

export interface BriefingWidgetProps {
  /** ISO date the headline belongs to, '' when there is no briefing. */
  date: string;
  /** "Has dormido bien: hoy toca rodaje suave", '' when not generated yet. */
  headline: string;
  linkBase: string;
}

const BriefingWidget = (props: BriefingWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const at = environment.date ?? new Date();
  const month = at.getMonth() + 1;
  const day = at.getDate();
  const entryDate = `${at.getFullYear()}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
  // Missing keys arrive undefined (see plist.ts): treat them as ''.
  const headline = props.date === entryDate && props.headline ? props.headline : '';
  const hasHeadline = headline.length > 0;
  const cta = 'Toca para escucharlo';
  const url = `${props.linkBase ?? 'roadtoironman://'}briefing?play=1`;
  const lockScreen = [containerBackground('clear', 'widget'), widgetURL(url)];

  if (environment.widgetFamily === 'accessoryInline') {
    return <Text modifiers={lockScreen}>{hasHeadline ? headline : 'Informe de hoy · escúchalo'}</Text>;
  }

  if (environment.widgetFamily === 'accessoryCircular') {
    return (
      <ZStack modifiers={lockScreen}>
        <AccessoryWidgetBackground />
        <VStack spacing={1}>
          <Image systemName={hasHeadline ? 'waveform' : 'sunrise.fill'} size={18} />
          <Text modifiers={[font({ size: 9, weight: 'semibold' })]}>{hasHeadline ? 'OÍR' : 'HOY'}</Text>
        </VStack>
      </ZStack>
    );
  }

  if (environment.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[...lockScreen, frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <HStack spacing={4}>
          <Image systemName="sunrise.fill" size={12} />
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>Informe de hoy</Text>
        </HStack>
        <Text modifiers={[font({ size: 14, weight: hasHeadline ? 'bold' : 'regular' }), lineLimit(2), minimumScaleFactor(0.85)]}>
          {hasHeadline ? headline : cta}
        </Text>
      </VStack>
    );
  }

  // systemSmall
  const dark = environment.colorScheme === 'dark';
  const ink = dark ? '#F2EFE8' : '#15171A';
  const paper = dark ? '#0D0F12' : '#F4F1EA';
  const muted = dark ? '#A3A6AD' : '#5E6066';
  return (
    <VStack alignment="leading" spacing={4} modifiers={[containerBackground(paper, 'widget'), widgetURL(url)]}>
      <Image systemName="sunrise.fill" size={22} color={ink} />
      <Text modifiers={[font({ size: 11, weight: 'heavy' }), kerning(1.2), foregroundStyle(muted)]}>INFORME DE HOY</Text>
      <Spacer />
      <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(ink), lineLimit(4), minimumScaleFactor(0.8)]}>
        {hasHeadline ? headline : 'Cómo has dormido y qué te toca hoy'}
      </Text>
      <HStack spacing={4}>
        <Image systemName="play.circle.fill" size={14} color={muted} />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1)]}>{cta}</Text>
      </HStack>
    </VStack>
  );
};

export default createWidget<BriefingWidgetProps>(
  'BriefingWidget',
  BriefingWidget,
  toPropertyList({ date: '', headline: '', linkBase: 'roadtoironman://' }),
);
