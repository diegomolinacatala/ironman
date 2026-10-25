/**
 * "Próximo entreno" lock-screen widget (accessoryRectangular / accessoryInline).
 * Lock-screen widgets render in vibrant (monochrome) mode, so no custom colours.
 *
 * iOS 17+ replaces any widget whose root has no `containerBackground` with the
 * "Please adopt containerBackground API" placeholder (expo-widgets adds none),
 * so EVERY branch's root sets a clear one to keep vibrant rendering intact.
 *
 * Isolated widget runtime: everything is declared inside the function.
 */
import { HStack, Image, Text, VStack, type ImageProps } from '@expo/ui/swift-ui';
import { containerBackground, font, frame, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

type SymbolName = NonNullable<ImageProps['systemName']>;

export interface NextWorkoutItem {
  id: string;
  title: string;
  sport: string;
  sportLabel: string;
  /** "Hoy 18:30", "Mañana", "jue 29 07:00". */
  when: string;
  duration: string;
  /** "con Álex" or "". */
  partner: string;
}

export interface NextWorkoutWidgetProps {
  next: NextWorkoutItem | null;
  linkBase: string;
}

const NextWorkoutWidget = (props: NextWorkoutWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const sportSymbols: Record<string, SymbolName> = {
    swim: 'figure.pool.swim',
    bike: 'figure.outdoor.cycle',
    run: 'figure.run',
    brick: 'figure.mixed.cardio',
    strength: 'figure.strengthtraining.traditional',
    mobility: 'figure.flexibility',
    other: 'sportscourt',
  };
  const next = props.next;
  const url = next ? `${props.linkBase}workout/${next.id}` : `${props.linkBase}today`;
  const root = [containerBackground('clear', 'widget'), widgetURL(url)];
  const stack = [...root, frame({ maxWidth: Infinity, alignment: 'leading' })];

  if (environment.widgetFamily === 'accessoryInline') {
    return <Text modifiers={root}>{next ? `${next.when} · ${next.title}` : 'Día de descanso'}</Text>;
  }

  if (!next) {
    return (
      <VStack alignment="leading" spacing={1} modifiers={stack}>
        <HStack spacing={4}>
          <Image systemName="bed.double" size={12} />
          <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>Próximos días</Text>
        </HStack>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), lineLimit(1)]}>Día de descanso</Text>
        <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>Sin entrenos planificados</Text>
      </VStack>
    );
  }

  const detail = next.partner ? `${next.duration} · ${next.partner}` : `${next.sportLabel} · ${next.duration}`;
  return (
    <VStack alignment="leading" spacing={1} modifiers={stack}>
      <HStack spacing={4}>
        <Image systemName={sportSymbols[next.sport] ?? 'figure.mixed.cardio'} size={12} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>{next.when}</Text>
      </HStack>
      <Text modifiers={[font({ size: 15, weight: 'bold' }), lineLimit(1)]}>{next.title}</Text>
      <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{detail}</Text>
    </VStack>
  );
};

export default createWidget<NextWorkoutWidgetProps>('NextWorkoutWidget', NextWorkoutWidget, { next: null, linkBase: 'rebufo://' });
