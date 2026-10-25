import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, space, type ScreenProps } from '@/ui';

import { useKeyboardInset } from './useKeyboardInset';

/** Bottom padding `Screen` itself reserves under a footer. */
const MIN_FOOTER_CLEARANCE = 96;

/** Scroll-content bottom padding that keeps the last field clear of a pinned footer of `footerHeight`. */
export function footerClearance(footerHeight: number, safeBottom: number): number {
  // Screen's footer adds paddingTop md + paddingBottom (safe area + md); keep a gap above it.
  return Math.max(MIN_FOOTER_CLEARANCE, Math.ceil(footerHeight + safeBottom + space.md * 2 + space.lg));
}

/**
 * `Screen` for forms: on iOS the content and the pinned footer rise above the
 * keyboard (also inside modal sheets), and the scroll content always clears
 * the footer, even when it grows with error messages.
 */
export function FormScreen({ footer, contentStyle, ...rest }: ScreenProps) {
  const { ref, inset } = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const clearance = footer ? { paddingBottom: footerClearance(footerHeight, insets.bottom) } : null;

  return (
    <View ref={ref} style={[styles.root, { paddingBottom: inset }]}>
      <Screen
        {...rest}
        contentStyle={[clearance, contentStyle]}
        footer={
          footer ? <View onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}>{footer}</View> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
