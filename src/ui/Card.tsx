import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from './haptics';
import { radius, space, useTheme, type ThemeColors } from './theme';

export type CardVariant = 'flat' | 'raised' | 'tinted' | 'inverse';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * 'flat' = surface + hairline border (default), 'raised' = surface + soft shadow (light mode
   * only; dark keeps the hairline), 'tinted' = custom bg (pass `tint`, e.g. `accentSoft`),
   * 'inverse' = high-emphasis inverse panel (rare).
   */
  variant?: CardVariant;
  tint?: string;
  /** Coloured left rail (e.g. sport colour). */
  rail?: string;
  padding?: keyof typeof space | 0;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const RAIL_WIDTH = 4;

function cardSurface(variant: CardVariant, colors: ThemeColors, isDark: boolean, tint?: string): ViewStyle {
  switch (variant) {
    case 'tinted':
      return { backgroundColor: tint ?? colors.surfaceAlt, borderColor: 'transparent' };
    case 'inverse':
      return { backgroundColor: colors.inverseBg, borderColor: 'transparent' };
    case 'raised':
      return isDark
        ? { backgroundColor: colors.surface, borderColor: colors.border }
        : {
            backgroundColor: colors.surface,
            borderColor: 'transparent',
            shadowColor: colors.shadow,
            shadowOpacity: 1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          };
    case 'flat':
      return { backgroundColor: colors.surface, borderColor: colors.border };
  }
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
  const inner = padding === 0 ? 0 : space[padding];
  // Raised cards must not clip (iOS would clip the shadow); their rail gets its own corners.
  const clips = !(variant === 'raised' && !isDark);
  const base: ViewStyle = {
    ...cardSurface(variant, colors, isDark, tint),
    padding: inner,
    paddingLeft: rail ? inner + RAIL_WIDTH : undefined,
    overflow: clips ? 'hidden' : 'visible',
  };
  const content = (
    <>
      {rail ? <View style={[styles.rail, !clips && styles.railRounded, { backgroundColor: rail }]} /> : null}
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
      style={({ pressed }) => [styles.card, base, pressed && styles.pressed, style]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Transform + opacity only: no layout shift while pressed.
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_WIDTH },
  railRounded: { borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg },
});
