import { StyleSheet, View } from 'react-native';

import type { RacePriority } from '@/domain/types';
import { Text, fonts, useTheme, type Theme } from '@/ui';

import { PRIORITY_INFO } from './raceModel';

interface BadgeStyle {
  bg: string;
  border: string;
  fg: string;
}

/** A = accent fill (the goal), B = soft brand tint, C = neutral outline. */
function badgeStyle(priority: RacePriority, colors: Theme['colors']): BadgeStyle {
  if (priority === 'A') return { bg: colors.accent, border: colors.accent, fg: colors.onAccent };
  if (priority === 'B') return { bg: colors.accentSoft, border: colors.accentSoft, fg: colors.onAccentSoft };
  return { bg: colors.surface, border: colors.borderStrong, fg: colors.textMuted };
}

/** A/B/C priority square. */
export function PriorityBadge({ priority, size = 28 }: { priority: RacePriority; size?: number }) {
  const { colors } = useTheme();
  const style = badgeStyle(priority, colors);
  return (
    <View
      accessible
      accessibilityLabel={`Prioridad ${priority}: ${PRIORITY_INFO[priority].title}`}
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: style.bg, borderColor: style.border },
      ]}>
      <Text maxFontSizeMultiplier={1} style={[styles.letter, { color: style.fg, fontSize: size * 0.5, lineHeight: size * 0.62 }]}>
        {priority}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  letter: { fontFamily: fonts.bodyBold },
});
