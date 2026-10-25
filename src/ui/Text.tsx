import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { type ThemeColors, type TypeVariant, type as typeStyles, useTheme } from './theme';

type ColorToken = 'text' | 'textMuted' | 'textFaint' | 'accentInk' | 'onAccent' | 'inverseText' | 'success' | 'warning' | 'danger' | 'info';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  /** Theme colour token, or any raw colour via `style`. */
  color?: ColorToken;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', color = 'text', align, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={1.4}
      style={[typeStyles[variant], { color: colors[color as keyof ThemeColors] }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
