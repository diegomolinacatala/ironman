import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { readableTextOn } from './color';
import { fonts, radius, space, useTheme } from './theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /**
   * Identity colour of the option (e.g. an intensity zone). Shown as a small dot (or tints the
   * icon); the selected state still uses the brand accent so every chip group reads the same.
   */
  color?: string;
  disabled?: boolean;
}

const CHIP_HEIGHT = 34;
const DOT = 8;

/**
 * Selectable pill used for options, filters and quick picks.
 *
 * Selection convention (app-wide): selected chips are an `accent` fill with `onAccent` content —
 * the same treatment as the primary button, so "chosen" always looks the same. Unselected chips
 * are `surface` + `border`. (`accentSoft` is reserved for highlighted surfaces, not controls.)
 */
export function Chip({ label, selected = false, onPress, icon, color, disabled }: ChipProps) {
  const { colors } = useTheme();
  const fg = selected ? colors.onAccent : colors.text;
  const iconColor = selected ? colors.onAccent : (color ?? colors.textMuted);
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
          backgroundColor: selected ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      {icon ? (
        <Icon name={icon} size={14} color={iconColor} />
      ) : color ? (
        <View
          testID="chip-dot"
          style={[styles.dot, { backgroundColor: color, borderColor: selected ? colors.onAccent : 'transparent' }]}
        />
      ) : null}
      <Text variant="caption" style={[styles.label, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface TagProps {
  label: string;
  color: string;
  /** Solid = filled with colour; soft = tinted background; outline = coloured border. */
  tone?: 'solid' | 'soft' | 'outline';
  icon?: IconName;
}

/** Non-interactive small label (status, intensity, "Juntos"…). Sentence case, radius `sm`. */
export function Tag({ label, color, tone = 'soft', icon }: TagProps) {
  const bg = tone === 'solid' ? color : tone === 'soft' ? `${color}1F` : 'transparent';
  const fg = tone === 'solid' ? readableTextOn(color) : color;
  return (
    <View style={[styles.tag, { backgroundColor: bg, borderColor: tone === 'outline' ? color : 'transparent' }]}>
      {icon ? <Icon name={icon} size={11} color={fg} weight="bold" /> : null}
      <Text variant="caption" style={[styles.tagLabel, { color: fg }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    height: CHIP_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1 },
  label: { fontFamily: fonts.bodySemibold },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  tagLabel: { fontFamily: fonts.bodySemibold, fontSize: 12, lineHeight: 16 },
});
