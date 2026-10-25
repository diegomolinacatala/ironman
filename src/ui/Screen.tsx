import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { space, useTheme } from './theme';

export interface ScreenProps {
  children: ReactNode;
  /** Big condensed title at the top of the scroll content. */
  title?: string;
  /** Small uppercase line above the title (e.g. "SEMANA 43"). */
  overline?: string;
  /** Element rendered at the right of the title row (buttons). */
  headerRight?: ReactNode;
  /** Scrollable by default; set false for screens managing their own list. */
  scroll?: boolean;
  /** Fixed element pinned to the bottom (e.g. a primary CTA). */
  footer?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Set when the screen is presented inside a native header/sheet (skips top inset). */
  inSheet?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Accessible label of the screen region. */
  accessibilityLabel?: string;
}

/**
 * Base screen: paper/ink background, safe areas, optional large title and
 * pull-to-refresh. Content gets a 16pt side gutter.
 */
export function Screen({
  children,
  title,
  overline,
  headerRight,
  scroll = true,
  footer,
  onRefresh,
  refreshing = false,
  inSheet = false,
  contentStyle,
  accessibilityLabel,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const top = inSheet ? space.lg : insets.top + space.md;

  const header =
    title || overline || headerRight ? (
      <View style={styles.header}>
        <View style={styles.headerText}>
          {overline ? (
            <Text variant="overline" color="textMuted">
              {overline}
            </Text>
          ) : null}
          {title ? (
            <Text variant="display" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
        </View>
        {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
      </View>
    ) : null;

  const padding = { paddingTop: top, paddingBottom: (footer ? 96 : insets.bottom + space.xxxl) };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityLabel={accessibilityLabel}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Native scroll-to-focused-input and bottom inset when the keyboard opens (iOS).
          automaticallyAdjustKeyboardInsets
          // Native headers on iOS 26+ are transparent (Liquid Glass): let iOS inset content below them.
          contentInsetAdjustmentBehavior={inSheet ? 'automatic' : 'never'}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} /> : undefined
          }>
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, padding, contentStyle]}>
          {header}
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + space.md, backgroundColor: colors.bg, borderTopColor: colors.border },
          ]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  content: { paddingHorizontal: space.lg, gap: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginBottom: space.xs },
  headerText: { flex: 1, gap: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: 4 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
