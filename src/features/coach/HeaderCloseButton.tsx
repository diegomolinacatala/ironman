import { Pressable, StyleSheet } from 'react-native';

import { Text, haptics } from '@/ui';

/** "Cerrar" header button for modal routes (iOS modals have no back button; VoiceOver users need one). */
export function HeaderCloseButton({ onPress, label = 'Cerrar' }: { onPress: () => void; label?: string }) {
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
