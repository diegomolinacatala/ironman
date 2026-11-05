import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Text, fonts, radius, space, useTheme } from '@/ui';

/** "con Álex" marker for joint sessions: soft brand tint, the app-wide "juntos" highlight. */
export function JuntosTag({ name }: { name: string }): JSX.Element {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`Quedada con ${name}`} style={[styles.tag, { backgroundColor: colors.accentSoft }]}>
      <Icon name="together" size={12} color={colors.onAccentSoft} weight="bold" />
      <Text variant="caption" style={[styles.label, { color: colors.onAccentSoft }]} numberOfLines={1}>
        {`con ${name}`}
      </Text>
    </View>
  );
}

/** "Clave" marker for key sessions (protected by the re-planner). */
export function KeyTag(): JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Sesión clave"
      style={[styles.tag, styles.outlined, { borderColor: colors.borderStrong }]}>
      <Icon name="key" size={11} color={colors.textMuted} weight="bold" />
      <Text variant="caption" style={[styles.label, { color: colors.text }]}>
        Clave
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  outlined: { borderWidth: 1, paddingVertical: 1 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, lineHeight: 16 },
});
