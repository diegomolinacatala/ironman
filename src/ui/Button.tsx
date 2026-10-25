import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, space, useTheme } from './theme';

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

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 56 };

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
  const palette = {
    primary: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent, border: 'transparent' },
    secondary: { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', pressed: colors.surfaceAlt, fg: colors.text, border: 'transparent' },
    danger: { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.danger, border: colors.border },
    inverse: { bg: colors.inverseBg, pressed: colors.textMuted, fg: colors.inverseText, border: 'transparent' },
  }[variant];
  const isDisabled = disabled || loading;
  const iconSize = size === 'sm' ? 14 : 18;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={size === 'sm' ? 4 : undefined}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? space.md : space.xl,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        fullWidth && styles.fullWidth,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={iconSize} color={palette.fg} /> : null}
          <Text
            variant={size === 'sm' ? 'caption' : 'bodyStrong'}
            style={{ color: palette.fg, letterSpacing: 0.2 }}
            numberOfLines={1}>
            {label}
          </Text>
          {iconRight ? <Icon name={iconRight} size={iconSize} color={palette.fg} /> : null}
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

export function IconButton({ icon, onPress, accessibilityLabel, variant = 'plain', size = 40, disabled }: IconButtonProps) {
  const { colors } = useTheme();
  const bg = variant === 'accent' ? colors.accent : variant === 'filled' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'accent' ? colors.onAccent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, backgroundColor: pressed ? colors.surfacePressed : bg, opacity: disabled ? 0.4 : 1 },
      ]}>
      <Icon name={icon} size={size * 0.45} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconButton: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
