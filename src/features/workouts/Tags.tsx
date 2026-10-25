import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Text, radius, useTheme } from '@/ui';

/** Lime "con Álex" highlight for joint sessions (lime = juntos). */
export function JuntosTag({ name }: { name: string }): JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Quedada con ${name}`}
      style={[styles.tag, { backgroundColor: colors.accent }]}>
      <Icon name="together" size={11} color={colors.onAccent} weight="bold" />
      <Text variant="overline" style={[styles.label, { color: colors.onAccent }]} numberOfLines={1}>
        {`con ${name}`}
      </Text>
    </View>
  );
}

/** "★ Clave" marker for key sessions (protected by the re-planner). */
export function KeyTag({ onInverse = false }: { onInverse?: boolean }): JSX.Element {
  const { colors } = useTheme();
  const fg = onInverse ? colors.inverseText : colors.text;
  return (
    <View
      accessible
      accessibilityLabel="Sesión clave"
      style={[styles.tag, { borderColor: fg, borderWidth: 1 }]}>
      <Text variant="overline" style={[styles.label, { color: fg }]}>
        ★ Clave
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  label: { fontSize: 11 },
});
