import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { Text, fonts, space, useTheme } from '@/ui';

const VALUE_POINTS = ['Lee tu Garmin', 'Vive en tu calendario', 'Le hablas y se adapta'] as const;

/** "IRONMAN" is 7 condensed caps: ~23 % of the width keeps it on one line on a 320 pt phone. */
const WORDMARK_RATIO = 0.235;
const MIN_WORDMARK = 56;
const MAX_WORDMARK = 120;
/** "ROAD TO" kicker relative to the wordmark size. */
const KICKER_RATIO = 0.3;

export interface BrandHeroProps {
  /** Safe-area top inset (the hero bleeds under the status bar). */
  topInset: number;
}

/**
 * Sign-in hero: ink panel, a tracked "ROAD TO" kicker over a big slanted
 * "IRONMAN" wordmark on a lime slash, speed stripes and the three value
 * points. Always ink, also in dark mode.
 */
export function BrandHero({ topInset }: BrandHeroProps) {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const wordmark = Math.max(MIN_WORDMARK, Math.min(MAX_WORDMARK, Math.round(Math.min(width, 720) * WORDMARK_RATIO)));
  const kicker = Math.round(wordmark * KICKER_RATIO);
  const ink = isDark ? colors.bgElevated : colors.inverseBg;
  const paper = isDark ? colors.text : colors.inverseText;

  return (
    <View style={[styles.hero, { backgroundColor: ink, paddingTop: topInset + space.xl }]}>
      <SpeedStripes color={colors.accent} />
      <Text variant="overline" style={{ color: colors.accent }}>
        Triatlón · Tu coach de bolsillo
      </Text>
      <View style={styles.wordmarkWrap} accessible accessibilityRole="header" accessibilityLabel="Road to Ironman">
        <Text
          allowFontScaling={false}
          style={[
            styles.kicker,
            {
              color: paper,
              fontSize: kicker,
              lineHeight: Math.round(kicker * 1.1),
              letterSpacing: Math.round(kicker * 0.32),
              fontFamily: fonts.displayHeavy,
            },
          ]}>
          ROAD TO
        </Text>
        <View>
          <View style={[styles.slash, { backgroundColor: colors.accent, height: wordmark * 0.34, bottom: wordmark * 0.06 }]} />
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.wordmark,
              { color: paper, fontSize: wordmark, lineHeight: wordmark * 0.96, fontFamily: fonts.displayHeavy },
            ]}>
            IRONMAN
          </Text>
        </View>
      </View>
      <Text variant="title" style={{ color: paper }}>
        Tu coach de bolsillo
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
  wordmarkWrap: { marginTop: space.xl, alignSelf: 'flex-start', maxWidth: '100%', transform: [{ skewX: '-9deg' }] },
  kicker: { includeFontPadding: false, marginBottom: space.xxs, marginLeft: 2 },
  wordmark: { letterSpacing: -1, includeFontPadding: false },
  slash: { position: 'absolute', left: -space.lg, right: -space.sm },
  points: { gap: space.sm, marginTop: space.sm },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
