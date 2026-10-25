import { Pressable, StyleSheet, View } from 'react-native';

import { raceDistanceDetail, raceDistanceLabel } from '@/domain/labels';
import { RACE_DISTANCES, type RaceDistance } from '@/domain/types';
import { Text, haptics, radius, space, useTheme } from '@/ui';

export interface DistancePickerProps {
  value: RaceDistance;
  onChange: (distance: RaceDistance) => void;
}

/** Two-column tiles: distance name + segment detail ("1,9 · 90 · 21,1 km"). */
export function DistancePicker({ value, onChange }: DistancePickerProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="overline" color="textMuted">
        Distancia
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Distancia de la carrera">
        {RACE_DISTANCES.map((d) => {
          const selected = d === value;
          const detail = raceDistanceDetail(d);
          return (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={detail ? `${raceDistanceLabel(d)}, ${detail}` : raceDistanceLabel(d)}
              onPress={() => {
                haptics.tap();
                onChange(d);
              }}
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: selected ? colors.inverseBg : pressed ? colors.surfacePressed : colors.surface,
                  borderColor: selected ? colors.inverseBg : colors.border,
                },
              ]}>
              <Text variant="bodyStrong" style={{ color: selected ? colors.inverseText : colors.text }} numberOfLines={1}>
                {raceDistanceLabel(d)}
              </Text>
              {detail ? (
                <Text variant="caption" style={{ color: selected ? colors.inverseText : colors.textMuted, opacity: selected ? 0.8 : 1 }} numberOfLines={1}>
                  {detail}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 2,
  },
});
