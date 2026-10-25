import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Text, haptics } from '@/ui';

/** Leaves the current route; falls back to `fallback` (Hoy) when opened from a deep link with no back stack. */
export function leaveTo(fallback: '/today' | '/races'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Closes a modal route; falls back to Hoy when opened from a deep link. */
export function closeModal(): void {
  leaveTo('/today');
}

export interface ModalCancelProps {
  label?: string;
  /** Defaults to `closeModal`. */
  onPress?: () => void;
}

/** "Cancelar" / "Cerrar" header button for modal routes (iOS modals have no back button). */
export function ModalCancel({ label = 'Cancelar', onPress = closeModal }: ModalCancelProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={styles.button}>
      <Text variant="bodyStrong">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
