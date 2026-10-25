import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { ErrorNotice, space } from '@/ui';

export interface FormFooterProps {
  /** Validation / submit errors; empty values are skipped. */
  errors: readonly (string | null | undefined)[];
  /** The primary action (usually one `Button`). */
  children: ReactNode;
}

/**
 * Pinned form footer: errors sit right above the primary button, so they are
 * visible wherever the form is scrolled, and VoiceOver reads them out.
 */
export function FormFooter({ errors, children }: FormFooterProps) {
  const visible = errors.filter((message): message is string => typeof message === 'string' && message.length > 0);
  const announcement = visible.join('. ');

  useEffect(() => {
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  return (
    <View style={styles.root} testID="form-footer">
      {visible.map((message) => (
        <ErrorNotice key={message} message={message} />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
});
