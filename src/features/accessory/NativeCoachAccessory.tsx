import { NativeTabs } from 'expo-router/native-tabs';

import { CoachAccessory } from './CoachAccessory';

/**
 * Content of `<NativeTabs.BottomAccessory>` (iOS 26+). iOS renders one copy per placement:
 * 'regular' above the tab bar, 'inline' inside the minimized tab bar (icons only).
 */
export function NativeCoachAccessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return <CoachAccessory placement={placement} surface="glass" />;
}
