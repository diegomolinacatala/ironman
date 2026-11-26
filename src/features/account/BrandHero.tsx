import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { Text, brand, radius, space } from '@/ui';

import { BrandMark } from './BrandMark';

/**
 * The hero is navy in both schemes, so its colours come from `brand`, not from the scheme:
 * paper text (13:1 on navy), sky for the subtitle (6:1), icon tiles one step lighter than the panel.
 */
const HERO = {
  bg: brand.navy,
  text: brand.paper,
  soft: brand.sky,
} as const;

const MARK_SIZE = 48;

export interface BrandHeroProps {
  /** Safe-area top inset (the hero bleeds under the status bar). */
  topInset: number;
}

/**
 * Sign-in hero: navy panel with the mark (road to the horizon under a rising sun), the
 * "Road to Ironman" wordmark, a one-line promise and the three things the coach does.
 */
export function BrandHero({ topInset }: BrandHeroProps) {
  return (
    <View testID="brand-hero" style={[styles.hero, { backgroundColor: HERO.bg, paddingTop: topInset + space.xl }]}>
      {/* Light status bar over the navy panel, also in light mode (restored when the hero unmounts). */}
      <StatusBar style="light" />
      <View style={styles.inner}>
        <BrandMark size={MARK_SIZE} />
        <View style={styles.titles}>
        <Text variant="hero" accessibilityRole="header" maxFontSizeMultiplier={1.2} style={{ color: HERO.text }}>
          Road to Ironman
        </Text>
        <Text variant="body" style={{ color: HERO.soft }}>
          Tu plan de triatlón, día a día.
        </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  titles: { gap: space.xs },
  inner: { width: '100%', maxWidth: 528, alignSelf: 'center', gap: space.lg },
});
