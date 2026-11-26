import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon, Text, haptics, space, useTheme } from '@/ui';

/**
 * The only weather hint without a city: one quiet line in Plan when the week has outdoor
 * sessions still to do (`needsPlaceHint`). It disappears once a city is set.
 */
export function WeatherPlaceHint() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Añade tu ciudad y tendré en cuenta la lluvia al planificar"
      onPress={() => {
        haptics.tap();
        router.push('/settings/weather');
      }}
      hitSlop={8}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Icon name="cloudSun" size={16} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.flex}>
        Añade tu ciudad y tendré en cuenta la lluvia al planificar.
      </Text>
      <Icon name="chevronRight" size={12} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32, paddingHorizontal: space.xs },
  flex: { flex: 1 },
});
