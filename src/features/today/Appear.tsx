import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

/** Delay between consecutive sections (V2.md §5: 30–50 ms stagger). */
const STAGGER_MS = 40;
const DURATION_MS = 260;

export interface AppearProps {
  /** Position in the screen; each step adds a small delay. */
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Soft entrance (fade + rise) for screen sections. Static when the user prefers reduced motion. */
export function Appear({ index = 0, children, style }: AppearProps) {
  const reduced = useReducedMotion();
  const entering = reduced ? undefined : FadeInDown.delay(index * STAGGER_MS).duration(DURATION_MS);
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
