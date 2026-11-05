import { StyleSheet } from 'react-native';

import { Text, fonts } from '@/ui';

/**
 * Sentence-case label above a group of form controls (chips, pickers, native date rows).
 * Matches the label `TextField` / `Stepper` draw, so every field in a form reads the same.
 */
export function FormLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" color="textMuted" style={styles.label}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bodySemibold },
});
