import { StyleSheet, View } from 'react-native';
import Svg, { Path, Polygon, Rect } from 'react-native-svg';

import { brand } from '@/ui';

const SUN_OPACITY = 0.85;
/** The horizon sits a little below the middle, as in the app icon (604 / 1024). */
const HORIZON = 604;
const SUN_RADIUS = 196;

const DASHES = [
  '509,640 515,640 517,668 507,668',
  '506,700 518,700 521,748 503,748',
  '501,792 523,792 528,866 496,866',
  '493,920 531,920 539,1024 485,1024',
] as const;

export interface BrandMarkProps {
  /** Side of the square tile, in points. */
  size?: number;
}

/**
 * The Road to Ironman mark: a road converging to the horizon under a rising sun, on navy.
 * Flat version of the app icon (no gradients) for in-app use. Decorative: the wordmark next to
 * it carries the name for VoiceOver.
 */
export function BrandMark({ size = 64 }: BrandMarkProps) {
  const half = `M${512 - SUN_RADIUS},${HORIZON} A${SUN_RADIUS},${SUN_RADIUS} 0 0 1 ${512 + SUN_RADIUS},${HORIZON} Z`;
  return (
    <View
      testID="brand-mark"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.225) }]}>
      <Svg width={size} height={size} viewBox="0 0 1024 1024">
        <Rect width={1024} height={1024} fill={brand.navy} />
        <Path d={half} fill={brand.sun} opacity={SUN_OPACITY} />
        <Rect x={0} y={HORIZON} width={1024} height={1024 - HORIZON} fill={brand.navyDeep} />
        <Polygon points={`498,${HORIZON} 526,${HORIZON} 840,1024 184,1024`} fill={brand.navyInk} />
        <Polygon points={`494,${HORIZON} 504,${HORIZON} 236,1024 176,1024`} fill={brand.paper} />
        <Polygon points={`520,${HORIZON} 530,${HORIZON} 848,1024 788,1024`} fill={brand.paper} />
        {DASHES.map((points) => (
          <Polygon key={points} points={points} fill={brand.paper} opacity={0.9} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden' },
});
