import { StyleSheet, View } from 'react-native';

import type { Readiness } from '@/domain/readiness';
import type { ISODate } from '@/domain/types';
import { Button, Card, Text, space, useTheme } from '@/ui';

import { closeModal } from '@/features/workouts/ModalClose';

import { ReadinessRing, readinessColor, readinessLabel } from './ReadinessRing';
import { useAdjustToday } from './useAdjustToday';

/** Readiness after saving the check-in; red suggests adjusting today's plan. */
export function CheckinResult({ readiness, date }: { readiness: Readiness; date: ISODate }) {
  const { colors } = useTheme();
  const adjust = useAdjustToday(date);
  const isRed = readiness.level === 'red';
  const tone = readinessColor(readiness.level, colors);
  return (
    <View style={styles.root}>
      <Card variant="raised" padding="lg" style={styles.card}>
        <View style={styles.center}>
          <ReadinessRing readiness={readiness} size={120} />
          <Text variant="overline" color="textMuted">
            Disposición de hoy
          </Text>
          <Text variant="title" style={{ color: readiness.level === 'unknown' ? colors.text : tone }} align="center">
            {readinessLabel(readiness.level)}
          </Text>
        </View>
        {readiness.factors.length > 0 ? (
          <View style={styles.factors}>
            {readiness.factors.map((f) => (
              <Text key={f} variant="callout" color="textMuted">
                {`· ${f}`}
              </Text>
            ))}
          </View>
        ) : null}
        <Text variant="body">{readiness.recommendation}</Text>
      </Card>
      {adjust.message ? (
        <Card variant="tinted" padding="md">
          <Text variant="callout">{adjust.message}</Text>
        </Card>
      ) : null}
      {isRed ? (
        <Button
          label="Ajustar hoy"
          icon="sparkles"
          size="lg"
          fullWidth
          loading={adjust.busy}
          onPress={() => void adjust.run(readiness)}
          accessibilityHint="Propone suavizar o mover las sesiones duras de hoy"
        />
      ) : null}
      <Button label={isRed ? 'Seguir con el plan' : 'Listo'} variant={isRed ? 'ghost' : 'primary'} size="lg" fullWidth onPress={closeModal} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  card: { gap: space.md },
  center: { alignItems: 'center', gap: space.xs },
  factors: { gap: 2 },
});
