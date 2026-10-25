import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

/**
 * Lifts a settings form above the iOS keyboard so the field being typed in
 * (and the save button) stay visible. The offset is the native header height
 * (0 outside a navigator, e.g. in tests).
 */
export function KeyboardAvoider({ children }: { children: ReactNode }) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
