import { Pressable, StyleSheet, View } from 'react-native';

import { raceDistanceDetail, raceDistanceLabel } from '@/domain/labels';
import { RACE_DISTANCES, type RaceDistance } from '@/domain/types';
import { Icon, Text, fonts, haptics, radius, space, useTheme } from '@/ui';

export interface DistancePickerProps {
  value: RaceDistance;
  onChange: (distance: RaceDistance) => void;
}

interface TileProps {
  distance: RaceDistance;
  selected: boolean;
  onPress: () => void;
}

/** Selected = soft brand tint + accent border + check (not a saturated fill). */
function DistanceTile({ distance, selected, onPress }: TileProps) {
  const { colors } = useTheme();
  const detail = raceDistanceDetail(distance);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={detail ? `${raceDistanceLabel(distance)}, ${detail}` : raceDistanceLabel(distance)}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
      ]}>
      <View style={styles.titleRow}>
        <Text variant="bodyStrong" style={[styles.flex, { color: selected ? colors.onAccentSoft : colors.text }]} numberOfLines={1}>
          {raceDistanceLabel(distance)}
        </Text>
        {selected ? <Icon name="checkCircle" size={16} color={colors.onAccentSoft} /> : null}
      </View>
      {detail ? (
        <Text variant="caption" style={{ color: selected ? colors.onAccentSoft : colors.textMuted }} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Two-column tiles: distance name + segment detail ("1,9 · 90 · 21,1 km"). */
export function DistancePicker({ value, onChange }: DistancePickerProps) {
  return (
    <View style={styles.field}>
      <Text variant="caption" color="textMuted" style={styles.label}>
        Distancia
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Distancia de la carrera">
        {RACE_DISTANCES.map((d) => (
          <DistanceTile key={d} distance={d} selected={d === value} onPress={() => onChange(d)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  label: { fontFamily: fonts.bodySemibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    gap: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
});
