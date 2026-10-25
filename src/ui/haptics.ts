import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

/** Fire-and-forget haptics; no-ops on web. */
export const haptics = {
  tap(): void {
    if (enabled) void Haptics.selectionAsync().catch(() => undefined);
  },
  impact(): void {
    if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  success(): void {
    if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  warning(): void {
    if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
};
