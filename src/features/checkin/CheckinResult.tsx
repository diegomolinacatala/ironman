import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Readiness } from '@/domain/readiness';
import type { ISODate } from '@/domain/types';
import { Button, Card, Text, space, useTheme } from '@/ui';

import { closeModal } from '@/features/workouts/ModalClose';

import { ReadinessRing, readinessColor, readinessLabel } from './ReadinessRing';
import { TodayAdviceCard } from './TodayAdviceCard';
import { todayAdvice } from './todayAdvice';
import { useAdjustToday } from './useAdjustToday';
import type { TodayPlan } from './useTodayPlan';

export interface CheckinResultProps {
  readiness: Readiness;
  date: ISODate;
  /** Today's week and the targets' inputs (`useTodayPlan`, loaded by the editor). */
  plan: TodayPlan;
}

function ReadinessCard({ readiness }: { readiness: Readiness }) {
  const { colors } = useTheme();
  const tone = readinessColor(readiness.level, colors);
  return (
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
  );
}

/**
 * Readiness after saving the check-in, today's session with what to do with it and, on amber
 * or red days, its easier version and "Ajustar hoy" (a proposal you review before applying).
 */
export function CheckinResult({ readiness, date, plan }: CheckinResultProps) {
  const { colors } = useTheme();
  const adjust = useAdjustToday(date);
  const advice = useMemo(
    () => todayAdvice(readiness, plan.workouts, date, plan.prescription),
    [readiness, plan.workouts, date, plan.prescription],
  );
  return (
    <View style={styles.root}>
      <ReadinessCard readiness={readiness} />
      <TodayAdviceCard advice={advice} />
      {adjust.message ? (
        <Card variant="tinted" tint={colors.accentSoft} padding="md">
          <Text variant="callout" color="onAccentSoft">
            {adjust.message}
          </Text>
        </Card>
      ) : null}
      {advice.canAdjust ? (
        <Button
          label="Ajustar hoy"
          icon="sparkles"
          size="lg"
          fullWidth
          loading={adjust.busy}
          onPress={() => void adjust.run(readiness)}
          accessibilityHint="Propone suavizar o mover la sesión de hoy; revisas los cambios antes de aplicarlos"
        />
      ) : null}
      <Button
        label={advice.canAdjust ? 'Seguir con el plan' : 'Listo'}
        variant={advice.canAdjust ? 'ghost' : 'primary'}
        size="lg"
        fullWidth
        onPress={closeModal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  card: { gap: space.md },
  center: { alignItems: 'center', gap: space.xs },
  factors: { gap: 2 },
});
