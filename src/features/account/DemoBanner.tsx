import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, radius, space, useTheme } from '@/ui';

const DEFAULT_MESSAGE =
  'Entras como Diego, con su compañero de piso Álex, una carrera objetivo y dos semanas de entrenos. Todo se guarda solo en este dispositivo.';

export interface DemoBannerProps {
  onEnter?: () => void;
  loading?: boolean;
  /** Context-specific explanation (defaults to the sign-in one). */
  message?: string;
}

/** Explains demo mode (no backend, sample data) and offers a one-tap entry. */
export function DemoBanner({ onEnter, loading = false, message = DEFAULT_MESSAGE }: DemoBannerProps) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.borderStrong }]}>
      <View style={styles.row}>
        <Icon name="sparkles" size={16} color={colors.text} />
        <Text variant="bodyStrong" style={styles.flex}>
          Modo demo: sin servidor, datos de ejemplo
        </Text>
      </View>
      <Text variant="caption" color="textMuted">
        {message}
      </Text>
      {onEnter ? (
        <Button label="Entrar en modo demo" variant="inverse" icon="bolt" loading={loading} onPress={onEnter} fullWidth />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
