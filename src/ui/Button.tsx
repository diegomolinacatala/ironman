import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { fonts, iconSize, radius, space, useTheme, type ThemeColors } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/** Minimum touch target (Apple HIG). */
const MIN_TARGET = 44;
const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 52 };
const PADDING_X: Record<ButtonSize, number> = { sm: space.md, md: space.lg, lg: space.xl };
const PRESSED_SCALE = 0.98;

interface ButtonPalette {
  bg: string;
  pressed: string;
  fg: string;
  border: string;
}

/**
 * One primary (accent fill) per screen; everything else is secondary (surface + border),
 * ghost (text link in brand ink), danger (destructive, outlined) or inverse (rare emphasis).
 */
export function buttonPalette(variant: ButtonVariant, colors: ThemeColors): ButtonPalette {
  switch (variant) {
    case 'primary':
      return { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent, border: colors.accent };
    case 'secondary':
      return { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.text, border: colors.borderStrong };
    case 'ghost':
      return { bg: 'transparent', pressed: colors.surfacePressed, fg: colors.accentInk, border: 'transparent' };
    case 'danger':
      return { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.danger, border: colors.borderStrong };
    case 'inverse':
      return { bg: colors.inverseBg, pressed: colors.inverseBg, fg: colors.inverseText, border: colors.inverseBg };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useTheme();
  const palette = buttonPalette(variant, colors);
  const isDisabled = disabled || loading;
  const glyph = size === 'sm' ? iconSize.sm : 18;
  const slop = Math.max(0, (MIN_TARGET - HEIGHT[size]) / 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={slop > 0 ? slop : undefined}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: PADDING_X[size],
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
          // Press feedback never shifts layout: colour + a transform-only scale.
          opacity: isDisabled ? 0.45 : pressed && variant === 'inverse' ? 0.9 : 1,
          transform: [{ scale: pressed ? PRESSED_SCALE : 1 }],
        },
        fullWidth && styles.fullWidth,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={glyph} color={palette.fg} /> : null}
          <Text
            variant={size === 'sm' ? 'caption' : 'bodyStrong'}
            style={[{ color: palette.fg }, size === 'sm' && styles.smallLabel]}
            numberOfLines={1}>
            {label}
          </Text>
          {iconRight ? <Icon name={iconRight} size={glyph} color={palette.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'accent';
  size?: number;
  disabled?: boolean;
}

function iconButtonColors(variant: NonNullable<IconButtonProps['variant']>, colors: ThemeColors) {
  if (variant === 'accent') return { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent };
  if (variant === 'filled') return { bg: colors.surfaceAlt, pressed: colors.surfacePressed, fg: colors.text };
  return { bg: 'transparent', pressed: colors.surfacePressed, fg: colors.text };
}

/** Round icon-only button; the hit area always reaches 44×44 pt. */
export function IconButton({ icon, onPress, accessibilityLabel, variant = 'plain', size = 40, disabled }: IconButtonProps) {
  const { colors } = useTheme();
  const tone = iconButtonColors(variant, colors);
  const slop = Math.max(4, (MIN_TARGET - size) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={slop}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          backgroundColor: pressed ? tone.pressed : tone.bg,
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? PRESSED_SCALE : 1 }],
        },
      ]}>
      <Icon name={icon} size={Math.round(size * 0.45)} color={tone.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  smallLabel: { fontFamily: fonts.bodySemibold, fontSize: 14 },
  iconButton: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
