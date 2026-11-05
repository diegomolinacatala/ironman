import { StyleSheet, View } from 'react-native';

import type { Sport } from '@/domain/types';

import { readableTextOn } from './color';
import { Icon } from './Icon';
import { radius, useTheme } from './theme';

export interface SportBadgeProps {
  sport: Sport;
  size?: number;
  /** 'tint' = soft bg + coloured glyph (default); 'solid' = coloured bg + white/ink glyph (selected use). */
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
        { width: size, height: size, borderRadius: Math.min(radius.xl, Math.round(size * 0.3)), backgroundColor: tone === 'solid' ? c.base : c.tint },
      ]}>
      <Icon name={sport} size={size * 0.52} color={tone === 'solid' ? readableTextOn(c.base) : c.base} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
