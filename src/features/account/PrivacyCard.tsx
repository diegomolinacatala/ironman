import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useUpdateProfile } from '@/data/queries';
import { visibilityHelp } from '@/domain/labels';
import type { CalendarVisibility } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { Card, Icon, Segmented, Text, haptics, space, useTheme } from '@/ui';

const OPTIONS: { value: CalendarVisibility; label: string }[] = [
  { value: 'full', label: 'Todo' },
  { value: 'summary', label: 'Resumen' },
  { value: 'busy', label: 'Solo ocupado' },
];

/** What friends see of my calendar. Saved immediately (optimistic, reverts on error). */
export function PrivacyCard({ value }: { value: CalendarVisibility }) {
  const { colors } = useTheme();
  const update = useUpdateProfile();
  const [pending, setPending] = useState<CalendarVisibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = pending ?? value;

  const onChange = async (visibility: CalendarVisibility) => {
    if (visibility === value) return;
    setPending(visibility);
    setError(null);
    try {
      await update.mutateAsync({ visibility });
      haptics.success();
    } catch (err) {
      logger.warn('visibility update failed', err);
      setError(errorMessage(err, 'No se pudo guardar. Inténtalo de nuevo.'));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card padding="lg">
      <View style={styles.head}>
        <Icon name="eye" size={18} color={colors.text} />
        <Text variant="bodyStrong" style={styles.flex}>
          Qué ven tus amigos
        </Text>
        {update.isPending ? (
          <Text variant="caption" color="textMuted">
            Guardando…
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <Segmented accessibilityLabel="Visibilidad del calendario" options={OPTIONS} value={shown} onChange={(v) => void onChange(v)} />
        <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
          {visibilityHelp(shown)}
        </Text>
        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  body: { gap: space.sm, marginTop: space.md },
});
