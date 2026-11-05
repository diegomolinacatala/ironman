import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { Icon, Text, brand, iconSize, radius, space, type IconName } from '@/ui';

import { BrandMark } from './BrandMark';

const VALUE_POINTS: readonly { icon: IconName; label: string }[] = [
  { icon: 'watch', label: 'Lee tu Garmin' },
  { icon: 'calendarCheck', label: 'Vive en tu calendario' },
  { icon: 'mic', label: 'Le hablas y se adapta' },
];

/**
 * The hero is navy in both schemes, so its colours come from `brand`, not from the scheme:
 * paper text (13:1 on navy), sky for the subtitle (6:1), icon tiles one step lighter than the panel.
 */
const HERO = {
  bg: brand.navy,
  text: brand.paper,
  soft: brand.sky,
  tile: brand.navyInk,
} as const;

const MARK_SIZE = 64;
const ICON_TILE = 32;

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
      <BrandMark size={MARK_SIZE} />
      <View style={styles.titles}>
        <Text variant="hero" accessibilityRole="header" maxFontSizeMultiplier={1.2} style={{ color: HERO.text }}>
          Road to Ironman
        </Text>
        <Text variant="body" style={{ color: HERO.soft }}>
          Tu coach de bolsillo para el triatlón
        </Text>
      </View>
      <View style={styles.points} accessibilityRole="list">
        {VALUE_POINTS.map((point) => (
          <View key={point.label} style={styles.point}>
            <View style={[styles.tile, { backgroundColor: HERO.tile }]}>
              <Icon name={point.icon} size={iconSize.sm} color={HERO.text} />
            </View>
            <Text variant="callout" style={[styles.flex, { color: HERO.text }]}>
              {point.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    gap: space.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  titles: { gap: space.xs },
  points: { gap: space.sm, marginTop: space.xs },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: ICON_TILE, height: ICON_TILE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
