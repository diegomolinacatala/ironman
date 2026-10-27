import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasNativeAccessory } from './coachActions';

/** Room for the floating iOS 26 tab bar + the coach accessory above it (pt, over the safe area). */
export const NATIVE_ACCESSORY_CLEARANCE = 140;

/**
 * Bottom padding for tab screens so the last card can scroll above the tab bar and the coach
 * accessory. Undefined = keep the `Screen` default (web and inline-accessory platforms).
 */
export function useTabBottomPadding(): number | undefined {
  const insets = useSafeAreaInsets();
  return hasNativeAccessory() ? insets.bottom + NATIVE_ACCESSORY_CLEARANCE : undefined;
}
