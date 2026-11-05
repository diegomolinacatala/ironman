import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Text, fonts } from '@/ui';

/** Sentence-case label above a group of controls (same look as the `TextField` label). */
export function FormLabel({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" color="textMuted" style={styles.label}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bodySemibold },
});
