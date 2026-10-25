import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { Text, fonts, space, useTheme } from '@/ui';

const VALUE_POINTS = ['Planifica tu semana', 'Reorganiza imprevistos', 'Cuadra quedadas'] as const;

const MIN_WORDMARK = 64;
const MAX_WORDMARK = 132;

export interface BrandHeroProps {
  /** Safe-area top inset (the hero bleeds under the status bar). */
  topInset: number;
}

/**
 * Sign-in hero: ink panel, slanted "REBUFO" wordmark over a lime slash,
 * speed stripes and the three value points. Always ink, also in dark mode.
 */
export function BrandHero({ topInset }: BrandHeroProps) {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const wordmark = Math.max(MIN_WORDMARK, Math.min(MAX_WORDMARK, Math.round(Math.min(width, 720) * 0.27)));
  const ink = isDark ? colors.bgElevated : colors.inverseBg;
  const paper = isDark ? colors.text : colors.inverseText;

  return (
    <View style={[styles.hero, { backgroundColor: ink, paddingTop: topInset + space.xl }]}>
      <SpeedStripes color={colors.accent} />
      <Text variant="overline" style={{ color: colors.accent }}>
        Triatlón · Entreno social
      </Text>
      <View style={styles.wordmarkWrap} accessible accessibilityRole="header" accessibilityLabel="Rebufo">
        <View style={[styles.slash, { backgroundColor: colors.accent, height: wordmark * 0.34, bottom: wordmark * 0.06 }]} />
        <Text
          allowFontScaling={false}
          style={[
            styles.wordmark,
            { color: paper, fontSize: wordmark, lineHeight: wordmark * 0.96, fontFamily: fonts.displayHeavy },
          ]}>
          REBUFO
        </Text>
      </View>
      <Text variant="title" style={{ color: paper }}>
        Entrena a rueda de tus amigos
      </Text>
      <View style={styles.points}>
        {VALUE_POINTS.map((point, index) => (
          <View key={point} style={styles.point}>
            <Text variant="metricSmall" style={{ color: colors.accent, width: 34 }}>
              {String(index + 1).padStart(2, '0')}
            </Text>
            <Text variant="bodyStrong" style={{ color: paper }}>
              {point}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Three slanted lime bars in the top-right corner (race-bib / slipstream motif). */
function SpeedStripes({ color }: { color: string }) {
  return (
    <View style={styles.stripes} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={180} height={140} viewBox="0 0 180 140">
        <Polygon points="70,0 110,0 60,140 20,140" fill={color} opacity={0.95} />
        <Polygon points="122,0 146,0 96,140 72,140" fill={color} opacity={0.55} />
        <Polygon points="158,0 170,0 120,140 108,140" fill={color} opacity={0.3} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  stripes: { position: 'absolute', top: 0, right: -20 },
  wordmarkWrap: { marginTop: space.xxl, alignSelf: 'flex-start', transform: [{ skewX: '-9deg' }] },
  wordmark: { letterSpacing: -1, includeFontPadding: false },
  slash: { position: 'absolute', left: -space.lg, right: -space.sm },
  points: { gap: space.sm, marginTop: space.sm },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
