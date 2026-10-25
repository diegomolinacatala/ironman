import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, space, useTheme } from './theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Colour used for the selected state (defaults to ink/inverse). */
  color?: string;
  disabled?: boolean;
}

/** Selectable pill used for options, filters and quick picks. */
export function Chip({ label, selected = false, onPress, icon, color, disabled }: ChipProps) {
  const { colors } = useTheme();
  const activeBg = color ?? colors.inverseBg;
  const fg = selected ? (color ? '#FFFFFF' : colors.inverseText) : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      // Visual height is 34 pt; the hit area reaches the 44 pt minimum.
      hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? activeBg : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? activeBg : colors.border,
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      {icon ? <Icon name={icon} size={14} color={selected ? fg : (color ?? colors.textMuted)} /> : null}
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface TagProps {
  label: string;
  color: string;
  /** Solid = filled with colour; soft = tinted background. */
  tone?: 'solid' | 'soft' | 'outline';
  icon?: IconName;
}

/** Non-interactive small label (status, intensity, "Juntos"…). */
export function Tag({ label, color, tone = 'soft', icon }: TagProps) {
  const bg = tone === 'solid' ? color : tone === 'soft' ? `${color}22` : 'transparent';
  const fg = tone === 'solid' ? '#FFFFFF' : color;
  return (
    <View style={[styles.tag, { backgroundColor: bg, borderColor: tone === 'outline' ? color : 'transparent' }]}>
      {icon ? <Icon name={icon} size={11} color={fg} weight="bold" /> : null}
      <Text variant="overline" style={{ color: fg, fontSize: 11 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
