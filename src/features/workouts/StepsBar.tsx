import { StyleSheet, View } from 'react-native';

import { INTENSITIES, type Intensity, type Sport, type WorkoutStep } from '@/domain/types';
import { Text, intensityColor, radius, space, useTheme } from '@/ui';

import { stepSegments } from './steps';

const BAR_HEIGHT = 56;

function barHeight(intensity: Intensity): number {
  const rank = INTENSITIES.indexOf(intensity);
  return Math.round(BAR_HEIGHT * (0.3 + (0.7 * (rank + 1)) / INTENSITIES.length));
}

export interface StepsBarProps {
  steps: readonly WorkoutStep[];
  intensity: Intensity;
  sport: Sport;
}

/**
 * Workout structure as proportional blocks (width = time, height + colour =
 * intensity), followed by a legend of each step.
 */
export function StepsBar({ steps, intensity, sport }: StepsBarProps) {
  const { colors } = useTheme();
  const segments = stepSegments(steps, intensity, sport);
  if (segments.length === 0) return null;
  const summary = segments.map((s) => s.label).join('; ');
  return (
    <View style={styles.root}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Estructura: ${summary}`}
        style={[styles.bar, { borderBottomColor: colors.borderStrong }]}>
        {segments.map((s) => (
          <View
            key={s.key}
            style={[
              styles.segment,
              { flexGrow: s.weight, height: barHeight(s.intensity), backgroundColor: intensityColor[s.intensity] },
            ]}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {segments.map((s) => (
          <View key={s.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: intensityColor[s.intensity] }]} />
            <Text variant="callout" style={styles.legendText}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_HEIGHT,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: { flexBasis: 0, minWidth: 4, borderTopLeftRadius: radius.sm / 2, borderTopRightRadius: radius.sm / 2 },
  legend: { gap: space.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { flex: 1 },
});
