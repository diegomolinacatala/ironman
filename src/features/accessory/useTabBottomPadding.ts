import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Our scroll views use explicit insets. Leave the last row above the floating iOS tab bar. */
export function useTabBottomPadding(): number | undefined {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26 ? insets.bottom + 64 : undefined;
}
