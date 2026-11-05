import { StyleSheet, View } from 'react-native';

import { Icon, Segmented, Text, setAppearancePreference, space, useAppearancePreference, useTheme } from '@/ui';
import type { AppearancePreference } from '@/ui';

const OPTIONS: { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];

const HINT: Record<AppearancePreference, string> = {
  system: 'Sigue el modo claro u oscuro de tu iPhone.',
  light: 'Siempre en modo claro.',
  dark: 'Siempre en modo oscuro.',
};

/**
 * Tú → Preferencias → Apariencia: follow the system, or force light / dark (saved on this
 * device). Rendered as a row inside a grouped list card (no card of its own).
 */
export function AppearancePicker() {
  const { colors } = useTheme();
  const preference = useAppearancePreference();
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <Icon name="appearance" size={18} color={colors.onAccentSoft} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyStrong">Apariencia</Text>
          <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
            {HINT[preference]}
          </Text>
        </View>
      </View>
      <Segmented
        accessibilityLabel="Apariencia"
        options={OPTIONS}
        value={preference}
        onChange={(value) => void setAppearancePreference(value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingVertical: space.md, paddingHorizontal: space.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
