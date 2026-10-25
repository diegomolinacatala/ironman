import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Text, space, useTheme } from '@/ui';

export interface StepCardProps {
  number: number;
  title: string;
  children: ReactNode;
  /** Marks the step as done (number turns into a filled bib). */
  done?: boolean;
}

/** Numbered guide step with a race-bib number. */
export function StepCard({ number, title, children, done = false }: StepCardProps) {
  const { colors } = useTheme();
  return (
    <Card padding="lg">
      <View style={styles.head}>
        <View
          style={[
            styles.bib,
            { backgroundColor: done ? colors.text : 'transparent', borderColor: colors.text },
          ]}>
          <Text variant="metric" style={{ color: done ? colors.bg : colors.text }} allowFontScaling={false}>
            {number}
          </Text>
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
  bib: { width: 48, height: 48, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  body: { marginTop: space.md, gap: space.md },
});
