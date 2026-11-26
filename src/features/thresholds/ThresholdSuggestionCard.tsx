import { StyleSheet, View } from 'react-native';

import type { ThresholdSuggestion } from '@/domain/thresholdSuggestions';
import { Button, Card, ErrorNotice, Icon, Text, space, useTheme } from '@/ui';

export interface ThresholdSuggestionCardProps {
  suggestion: ThresholdSuggestion;
  onAccept: () => void;
  onSnooze: () => void;
  busy?: boolean;
  error?: string | null;
}

/**
 * «Tu umbral de carrera parece haber mejorado a 4:32/km (antes 4:40). ¿Lo actualizo?»
 * Calm and optional: nothing changes until the athlete taps «Actualizar».
 */
export function ThresholdSuggestionCard({ suggestion, onAccept, onSnooze, busy = false, error = null }: ThresholdSuggestionCardProps) {
  const { colors } = useTheme();
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="md" style={styles.card}>
      <View style={styles.head}>
        <Icon name="progress" size={20} color={colors.onAccentSoft} />
        <Text variant="bodyStrong" color="onAccentSoft" style={styles.flex}>
          {suggestion.message}
        </Text>
      </View>
      <Text variant="caption" color="onAccentSoft">
        {suggestion.evidence}
      </Text>
      {error ? <ErrorNotice message={error} /> : null}
      <View style={styles.actions}>
        <Button label="Ahora no" variant="ghost" size="sm" onPress={onSnooze} disabled={busy} />
        <Button label="Actualizar" size="sm" icon="check" onPress={onAccept} loading={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
