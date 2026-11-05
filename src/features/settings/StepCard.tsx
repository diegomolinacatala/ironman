import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text, radius, space, useTheme } from '@/ui';

export interface StepCardProps {
  number: number;
  title: string;
  children: ReactNode;
  /** Marks the step as done (the number becomes a check on the accent). */
  done?: boolean;
}

const BADGE = 32;

/** Numbered guide step: a calm number badge (soft accent; accent + check when done). */
export function StepCard({ number, title, children, done = false }: StepCardProps) {
  const { colors } = useTheme();
  return (
    <Card padding="lg">
      <View style={styles.head}>
        <View
          accessibilityLabel={done ? `Paso ${number}, hecho` : `Paso ${number}`}
          style={[styles.badge, { backgroundColor: done ? colors.accent : colors.accentSoft }]}>
          {done ? (
            <Icon name="check" size={16} color={colors.onAccent} weight="bold" />
          ) : (
            <Text variant="bodyStrong" style={{ color: colors.onAccentSoft }} maxFontSizeMultiplier={1.2}>
              {number}
            </Text>
          )}
        </View>
        <Text variant="heading" style={styles.flex} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={styles.body}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: { width: BADGE, height: BADGE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  body: { marginTop: space.md, gap: space.md },
});
