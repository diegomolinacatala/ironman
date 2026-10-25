import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { fuelingHint } from '@/domain/fueling';
import type { Workout } from '@/domain/types';
import { Card, Icon, Text, haptics, space, useTheme } from '@/ui';

/** Sessions from this length show the fueling hint on Hoy. */
export const FUELING_MIN_DURATION = 75;

export interface FuelingHintProps {
  workout: Pick<Workout, 'sport' | 'durationMin' | 'intensity'>;
  /** Start expanded (detail screen) or collapsed (Hoy). */
  defaultOpen?: boolean;
}

/** Collapsible "Nutrición" card: before / during / after (general guidance). */
export function FuelingHint({ workout, defaultOpen = false }: FuelingHintProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const hint = fuelingHint({ sport: workout.sport, durationMin: workout.durationMin, intensity: workout.intensity });
  const headline = hint.carbsPerHour ? `${hint.carbsPerHour} g/h de hidratos durante` : 'Qué comer antes y después';

  return (
    <Card variant="tinted" tint={colors.surfaceAlt} padding="md">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Nutrición para esta sesión. ${headline}`}
        onPress={() => {
          haptics.tap();
          setOpen((v) => !v);
        }}
        style={styles.header}>
        <Icon name="food" size={18} color={colors.text} />
        <View style={styles.headerText}>
          <Text variant="overline" color="textMuted">
            Nutrición
          </Text>
          <Text variant="bodyStrong">{headline}</Text>
        </View>
        <Icon name="chevronDown" size={16} color={colors.textMuted} style={open ? styles.rotated : undefined} />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <FuelLine label="Antes" text={hint.before} />
          {hint.during ? <FuelLine label="Durante" text={hint.during} /> : null}
          <FuelLine label="Después" text={hint.after} />
          <Text variant="caption" color="textFaint">
            Pautas generales, no consejo médico.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function FuelLine({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.line}>
      <Text variant="overline" color="textMuted" style={styles.lineLabel}>
        {label}
      </Text>
      <Text variant="callout" style={styles.lineText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  headerText: { flex: 1, gap: 2 },
  rotated: { transform: [{ rotate: '180deg' }] },
  body: { gap: space.md, marginTop: space.md },
  line: { flexDirection: 'row', gap: space.md },
  lineLabel: { width: 64, paddingTop: 3 },
  lineText: { flex: 1 },
});
