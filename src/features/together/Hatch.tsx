import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

export interface HatchProps {
  /** Stripe colour. */
  color: string;
  /** Fill behind the stripes. */
  background: string;
  spacing?: number;
  strokeWidth?: number;
}

/** Diagonal hatching that fills its parent — the visual for "Ocupado". */
export function Hatch({ color, background, spacing = 6, strokeWidth = 1.5 }: HatchProps) {
  const id = `hatch${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={spacing} height={spacing} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={spacing} height={spacing} fill={background} />
            <Path d={`M0 0 L0 ${spacing}`} stroke={color} strokeWidth={strokeWidth} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
});
