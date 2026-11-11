import { Pressable, StyleSheet } from 'react-native';

import { Icon, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

export const HR_HINT_TEXT = 'Añade tu FC umbral o tu FC máxima en Tú › Perfil y verás pulsaciones';

/** Discreet link to the thresholds editor when the session can't show heart rate yet. */
export function ThresholdsHint({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={HR_HINT_TEXT}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}>
      <Icon name="heartOutline" size={iconSize.sm} color={colors.accentInk} />
      <Text variant="caption" color="textMuted" style={styles.text}>
        {HR_HINT_TEXT}
      </Text>
      <Icon name="chevronRight" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
});
