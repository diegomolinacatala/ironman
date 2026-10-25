import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Compliance } from '@/domain/load';
import { Icon, Text, fonts, useTheme } from '@/ui';

import { complianceMeta } from './complianceMeta';

export interface ComplianceDotProps {
  state: Compliance;
  size?: number;
}

/**
 * Compliance indicator (TrainingPeaks convention): colour + glyph, never
 * colour alone. Pending workouts render as a neutral outline.
 */
export function ComplianceDot({ state, size = 18 }: ComplianceDotProps): JSX.Element {
  const { colors } = useTheme();
  const meta = complianceMeta(state);
  const fg = meta.color ? '#FFFFFF' : colors.textMuted;
  const glyphSize = Math.round(size * 0.62);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={meta.label}
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: meta.color ?? 'transparent',
          borderColor: meta.color ?? colors.borderStrong,
        },
      ]}>
      {'icon' in meta.glyph ? (
        <Icon name={meta.glyph.icon} size={glyphSize} color={fg} weight="bold" />
      ) : (
        <Text
          allowFontScaling={false}
          style={[styles.glyph, { color: fg, fontSize: glyphSize + 2, lineHeight: size - 2 }]}>
          {meta.glyph.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  glyph: { fontFamily: fonts.displayHeavy, textAlign: 'center', includeFontPadding: false },
});
