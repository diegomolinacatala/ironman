import { StyleSheet, View } from 'react-native';

import type { CalendarVisibility } from '@/domain/types';
import { Icon, Text, radius, space, useTheme } from '@/ui';

const COPY: Record<CalendarVisibility, { text: string; icon: 'eye' | 'lock' }> = {
  full: { text: 'su calendario completo', icon: 'eye' },
  summary: { text: 'deporte y duración, sin títulos', icon: 'eye' },
  busy: { text: 'solo ocupado/libre', icon: 'lock' },
};

/** "Álex comparte: solo ocupado/libre". Hidden when it cannot be inferred. */
export function VisibilityNotice({ friendName, visibility }: { friendName: string; visibility: CalendarVisibility | null }) {
  const { colors } = useTheme();
  if (!visibility) return null;
  const copy = COPY[visibility];
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="text">
      <Icon name={copy.icon} size={14} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.text}>
        {friendName} comparte: {copy.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
});
