import { Pressable, StyleSheet, View } from 'react-native';

import { weekdayLabel, weekdayShort } from '@/domain/labels';
import type { TrainingWindow } from '@/domain/types';
import { Icon, Text, haptics, radius, space, useTheme } from '@/ui';

export interface CustomWindowsListProps {
  windows: readonly TrainingWindow[];
  onRemove: (window: TrainingWindow) => void;
}

/**
 * Windows that are not one of the three presets (set by the coach, Claude or
 * an older version): listed so they stay visible and removable.
 */
export function CustomWindowsList({ windows, onRemove }: CustomWindowsListProps) {
  const { colors } = useTheme();
  if (windows.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text variant="overline" color="textMuted">
        Otras franjas
      </Text>
      <View style={styles.chips}>
        {windows.map((w) => (
          <Pressable
            key={`${w.weekday}-${w.start}-${w.end}`}
            accessibilityRole="button"
            accessibilityLabel={`Quitar franja ${weekdayLabel(w.weekday)} de ${w.start} a ${w.end}`}
            onPress={() => {
              haptics.tap();
              onRemove(w);
            }}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border },
            ]}>
            <Text variant="caption">
              {weekdayShort(w.weekday)} {w.start}–{w.end}
            </Text>
            <Icon name="close" size={12} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
