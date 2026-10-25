import { StyleSheet, View } from 'react-native';

import type { Sport } from '@/domain/types';

import { Icon } from './Icon';
import { useTheme } from './theme';

export interface SportBadgeProps {
  sport: Sport;
  size?: number;
  /** 'tint' = soft bg + coloured glyph; 'solid' = coloured bg + white glyph. */
  tone?: 'tint' | 'solid';
}

export function SportBadge({ sport, size = 40, tone = 'tint' }: SportBadgeProps) {
  const theme = useTheme();
  const c = theme.sport(sport);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size * 0.32, backgroundColor: tone === 'solid' ? c.base : c.tint },
      ]}>
      <Icon name={sport} size={size * 0.52} color={tone === 'solid' ? '#FFFFFF' : c.base} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
