import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from './haptics';
import { radius, space, useTheme } from './theme';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** 'flat' = bordered surface, 'raised' = shadowed, 'tinted' = custom bg (pass `tint`). */
  variant?: 'flat' | 'raised' | 'tinted' | 'inverse';
  tint?: string;
  /** Coloured left rail (e.g. sport colour). */
  rail?: string;
  padding?: keyof typeof space | 0;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Card({
  children,
  onPress,
  onLongPress,
  variant = 'flat',
  tint,
  rail,
  padding = 'lg',
  style,
  accessibilityLabel,
}: CardProps) {
  const { colors, isDark } = useTheme();
  const bg =
    variant === 'tinted' ? (tint ?? colors.surfaceAlt) : variant === 'inverse' ? colors.inverseBg : colors.surface;
  const base: ViewStyle = {
    backgroundColor: bg,
    borderColor: variant === 'flat' ? colors.border : 'transparent',
    padding: padding === 0 ? 0 : space[padding],
    paddingLeft: rail ? (padding === 0 ? 0 : space[padding]) + 6 : undefined,
    ...(variant === 'raised' && !isDark
      ? { shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 3 }
      : null),
  };
  const content = (
    <>
      {rail ? <View style={[styles.rail, { backgroundColor: rail }]} /> : null}
      {children}
    </>
  );

  if (!onPress && !onLongPress) {
    return <View style={[styles.card, base, style]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={
        onPress
          ? () => {
              haptics.tap();
              onPress();
            }
          : undefined
      }
      onLongPress={
        onLongPress
          ? () => {
              haptics.impact();
              onLongPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.card,
        base,
        pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 },
        style,
      ]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
});
