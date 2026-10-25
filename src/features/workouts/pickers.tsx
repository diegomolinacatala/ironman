import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { intensityLabel, sportLabel } from '@/domain/labels';
import { INTENSITIES, SPORTS, type Intensity, type Sport } from '@/domain/types';
import { Chip, SportBadge, Text, haptics, intensityColor, radius, space, useTheme } from '@/ui';

export function SportPicker({ value, onChange }: { value: Sport; onChange: (s: Sport) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sportRow}
      accessibilityRole="radiogroup"
      accessibilityLabel="Deporte">
      {SPORTS.map((sport) => (
        <SportOption key={sport} sport={sport} selected={sport === value} onPress={() => onChange(sport)} />
      ))}
    </ScrollView>
  );
}

function SportOption({ sport, selected, onPress }: { sport: Sport; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.sport(sport);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={sportLabel(sport)}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.sport,
        {
          borderColor: selected ? c.base : theme.colors.border,
          backgroundColor: selected ? c.tint : pressed ? theme.colors.surfacePressed : theme.colors.surface,
        },
      ]}>
      <SportBadge sport={sport} size={36} tone={selected ? 'solid' : 'tint'} />
      <Text variant="caption" color={selected ? 'text' : 'textMuted'} numberOfLines={1}>
        {sportLabel(sport)}
      </Text>
    </Pressable>
  );
}

export function IntensityPicker({ value, onChange }: { value: Intensity; onChange: (i: Intensity) => void }) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Intensidad">
      {INTENSITIES.map((i) => (
        <Chip key={i} label={intensityLabel(i)} selected={i === value} color={intensityColor[i]} onPress={() => onChange(i)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sportRow: { gap: space.sm, paddingVertical: 2 },
  sport: {
    width: 76,
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
