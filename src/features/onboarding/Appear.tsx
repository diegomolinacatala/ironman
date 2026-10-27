import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

/** Stagger between consecutive blocks (ms). */
const STAGGER_MS = 40;
const DURATION_MS = 260;

export interface AppearProps {
  children: ReactNode;
  /** Position in the stagger (0 = first). */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/** Soft entrance (fade + rise) for a block of a step; none at all with "Reduce motion" on. */
export function Appear({ children, index = 0, style }: AppearProps) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.delay(index * STAGGER_MS).duration(DURATION_MS)} style={style}>
      {children}
    </Animated.View>
  );
}
