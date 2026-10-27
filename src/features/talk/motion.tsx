/**
 * The only Reanimated code of the voice coach and the meal flow (kept in one
 * module so tests can swap it for plain views). Every animation respects the
 * system "Reduce Motion" setting: entrances are skipped and loops stay still.
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { duration } from '@/ui';

const STAGGER_MS = 40;

/** Soft entrance (fade + rise), staggered by `index`. */
export function FadeIn({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const entering = reduced ? undefined : FadeInDown.duration(duration.normal).delay(index * STAGGER_MS);
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

export interface PulseRingProps {
  active: boolean;
  /** Mic level 0..1. */
  level: number;
  size: number;
  color: string;
}

/** Breathing halo behind the mic that swells with the voice level while listening. */
export function PulseRing({ active, level, size, color }: PulseRingProps) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(1);
  const amp = useSharedValue(0);
  const visible = useSharedValue(0);

  useEffect(() => {
    visible.value = withTiming(active ? 1 : 0, { duration: duration.fast });
    if (active && !reduced) {
      breath.value = withRepeat(withTiming(1.1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      cancelAnimation(breath);
      breath.value = withTiming(1, { duration: duration.fast });
    }
  }, [active, reduced, breath, visible]);

  useEffect(() => {
    const clamped = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    amp.value = active && !reduced ? withSpring(clamped, { damping: 14, stiffness: 180 }) : 0;
  }, [level, active, reduced, amp]);

  const halo = useAnimatedStyle(() => ({
    opacity: visible.value * 0.28,
    transform: [{ scale: breath.value + amp.value * 0.45 }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: visible.value * 0.6,
    transform: [{ scale: 1.08 + amp.value * 0.2 }],
  }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, styles.abs, halo]} />
      <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, borderColor: color }, styles.ring, styles.abs, ring]} />
    </View>
  );
}

/** Placeholder block that gently pulses while something loads. */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 0.7 : 0.45);

  useEffect(() => {
    if (reduced) return undefined;
    opacity.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduced, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[style, animated]} />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  ring: { borderWidth: 3 },
});
