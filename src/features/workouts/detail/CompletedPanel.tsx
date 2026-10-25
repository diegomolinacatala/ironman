import { StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '@/domain/dates';
import type { Compliance } from '@/domain/load';
import type { CompletedData, Workout } from '@/domain/types';
import { Card, Divider, Text, space } from '@/ui';

import { ComplianceDot } from '../ComplianceDot';
import { complianceMeta } from '../complianceMeta';
import { rpeLabel } from '../rpe';

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Registrado a mano',
  healthkit: 'Desde Apple Salud',
  garmin: 'Desde Garmin',
  claude: 'Registrado por tu Claude',
};

/** Plan vs real for completed workouts; skipped notice otherwise. */
export function CompletedPanel({ workout, compliance }: { workout: Workout; compliance: Compliance }) {
  if (workout.status === 'skipped') {
    return (
      <Card variant="tinted" padding="md">
        <View style={styles.row}>
          <ComplianceDot state={compliance} />
          <Text variant="bodyStrong" style={styles.flex}>
            Saltado
          </Text>
        </View>
        {workout.completed?.notes ? (
          <Text variant="callout" color="textMuted" style={styles.notes}>
            {workout.completed.notes}
          </Text>
        ) : null}
      </Card>
    );
  }
  if (workout.status !== 'completed') return null;
  const done: CompletedData = workout.completed ?? {};
  const meta = complianceMeta(compliance);
  return (
    <Card padding="md" style={styles.card}>
      <View style={styles.row}>
        <ComplianceDot state={compliance} size={24} />
        <View style={styles.flex}>
          <Text variant="overline" color="textMuted">
            Hecho
          </Text>
          <Text variant="heading">{meta.label}</Text>
        </View>
        {done.source ? (
          <Text variant="caption" color="textMuted">
            {SOURCE_LABEL[done.source] ?? ''}
          </Text>
        ) : null}
      </View>
      <Divider />
      <CompareRow label="Duración" plan={formatDuration(workout.durationMin)} real={done.durationMin != null ? formatDuration(done.durationMin) : '—'} />
      {workout.distanceM != null || done.distanceM != null ? (
        <CompareRow
          label="Distancia"
          plan={workout.distanceM != null ? formatDistance(workout.distanceM, workout.sport) : '—'}
          real={done.distanceM != null ? formatDistance(done.distanceM, workout.sport) : '—'}
        />
      ) : null}
      {done.avgHr != null ? <CompareRow label="FC media" plan="" real={`${Math.round(done.avgHr)} ppm`} /> : null}
      {done.rpe != null ? <CompareRow label="RPE" plan="" real={`${done.rpe}/10 · ${rpeLabel(done.rpe)}`} /> : null}
      {done.notes ? (
        <Text variant="callout" style={styles.notes}>
          {done.notes}
        </Text>
      ) : null}
    </Card>
  );
}

function CompareRow({ label, plan, real }: { label: string; plan: string; real: string }) {
  return (
    <View style={styles.compare} accessible accessibilityLabel={`${label}: ${real}${plan ? `, plan ${plan}` : ''}`}>
      <Text variant="overline" color="textMuted" style={styles.compareLabel}>
        {label}
      </Text>
      <Text variant="caption" color="textMuted" style={styles.plan}>
        {plan ? `plan ${plan}` : ''}
      </Text>
      <Text variant="metricSmall">{real}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  notes: { marginTop: space.xs },
  compare: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  compareLabel: { width: 76 },
  plan: { flex: 1 },
});
