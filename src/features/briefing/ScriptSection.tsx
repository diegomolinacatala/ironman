import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Card, Icon, Text, haptics, space, useTheme } from '@/ui';

/** Collapsible "Leer el informe": the full script, for reading instead of listening. */
export function ScriptSection({ script }: { script: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  return (
    <Card padding="md" style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Leer el informe"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptics.tap();
          setOpen((v) => !v);
        }}
        style={styles.header}>
        <Icon name="book" size={18} color={colors.textMuted} />
        <Text variant="bodyStrong" style={styles.flex}>
          Leer el informe
        </Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={14} color={colors.textMuted} />
        </View>
      </Pressable>
      {open ? (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(200)}>
          <Text variant="body" selectable style={styles.script}>
            {script}
          </Text>
        </Animated.View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  flex: { flex: 1 },
  script: { lineHeight: 24 },
});
