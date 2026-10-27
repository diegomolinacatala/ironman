/**
 * Global `react-native-reanimated` stand-in for jest (installed by `jest.setup.ts`).
 * The package's own mock loads the native worklets runtime, which crashes under jest-expo,
 * so tests get plain views: entrances render immediately and loops stay still.
 */
import { ScrollView, Text, View } from 'react-native';

interface LayoutAnimationMock {
  delay: () => LayoutAnimationMock;
  duration: () => LayoutAnimationMock;
  springify: () => LayoutAnimationMock;
  damping: () => LayoutAnimationMock;
  reduceMotion: () => LayoutAnimationMock;
  withInitialValues: () => LayoutAnimationMock;
}

const layoutAnimation: LayoutAnimationMock = {
  delay: () => layoutAnimation,
  duration: () => layoutAnimation,
  springify: () => layoutAnimation,
  damping: () => layoutAnimation,
  reduceMotion: () => layoutAnimation,
  withInitialValues: () => layoutAnimation,
};

const identity = <T,>(component: T): T => component;

const Animated = { View, Text, ScrollView, createAnimatedComponent: identity };

export default Animated;
export const createAnimatedComponent = identity;
export const FadeIn = layoutAnimation;
export const FadeInDown = layoutAnimation;
export const FadeInUp = layoutAnimation;
export const FadeOut = layoutAnimation;
export const LinearTransition = layoutAnimation;
export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' } as const;

const curve = () => (t: number) => t;
export const Easing = { linear: curve(), ease: curve(), in: curve, out: curve, inOut: curve, bezier: curve, quad: curve() };

export const useReducedMotion = (): boolean => false;

export function useSharedValue<T>(initial: T): { value: T; get: () => T; set: (value: T) => void } {
  const shared = { value: initial, get: () => shared.value, set: (value: T) => void (shared.value = value) };
  return shared;
}

export function useAnimatedStyle<T>(factory: () => T): T {
  return factory();
}

export const withRepeat = <T,>(value: T): T => value;
export const withTiming = <T,>(value: T): T => value;
export const withSpring = <T,>(value: T): T => value;
export const withSequence = <T,>(...values: T[]): T | undefined => values[values.length - 1];
export const withDelay = <T,>(_delay: number, value: T): T => value;
export const cancelAnimation = (): void => undefined;
export const runOnJS = <T extends (...args: never[]) => unknown>(fn: T): T => fn;
