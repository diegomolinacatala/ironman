import { StyleSheet, View } from 'react-native';

import type { Compliance } from '@/domain/load';
import type { RaceDistance, Thresholds, Workout } from '@/domain/types';
import { Card, Divider, Text, space } from '@/ui';

import { ComplianceDot } from '../ComplianceDot';
import { complianceMeta } from '../complianceMeta';
import { completedSourceLabel, planVsRealRows, type CompareRow } from '../targets';

export interface CompletedPanelProps {
  workout: Workout;
  compliance: Compliance;
  thresholds: Thresholds | null;
  raceDistance: RaceDistance | null;
}

const LABEL_WIDTH = 96;

/** Plan vs real for completed workouts (duration, distance, FC media, RPE, sensaciones); skipped notice otherwise. */
export function CompletedPanel({ workout, compliance, thresholds, raceDistance }: CompletedPanelProps) {
  if (workout.status === 'skipped') return <SkippedPanel workout={workout} compliance={compliance} />;
  if (workout.status !== 'completed') return null;
  const meta = complianceMeta(compliance);
  const source = completedSourceLabel(workout);
  const rows = planVsRealRows(workout, thresholds, { raceDistance });
  const notes = workout.completed?.notes;
  return (
    <Card padding="md" style={styles.card}>
      <View style={styles.row}>
        <ComplianceDot state={compliance} size={24} />
        <View style={styles.flex}>
          <Text variant="caption" color="textMuted">
            Hecho
          </Text>
          <Text variant="heading">{meta.label}</Text>
        </View>
        {source ? (
          <Text variant="caption" color="textMuted">
            {source}
          </Text>
        ) : null}
      </View>
      <Divider />
      <View style={styles.table}>
        <View style={styles.compare} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={styles.label} />
          <Text variant="caption" color="textMuted" style={styles.cell}>
            Plan
          </Text>
          <Text variant="caption" color="textMuted" style={styles.cell}>
            Hecho
          </Text>
        </View>
        {rows.map((row) => (
          <CompareLine key={row.label} row={row} />
        ))}
      </View>
      {notes ? (
        <Text variant="callout" style={styles.notes}>
          {notes}
        </Text>
      ) : null}
    </Card>
  );
}

function SkippedPanel({ workout, compliance }: { workout: Workout; compliance: Compliance }) {
  return (
    <Card variant="tinted" padding="md">
      <View style={styles.row}>
        <ComplianceDot state={compliance} size={24} />
        <Text variant="heading" style={styles.flex}>
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

function CompareLine({ row }: { row: CompareRow }) {
  return (
    <View style={styles.compare} accessible accessibilityLabel={`${row.label}: ${row.real}${row.plan ? `, plan ${row.plan}` : ''}`}>
      <Text variant="callout" color="textMuted" style={styles.label}>
        {row.label}
      </Text>
      <Text variant="callout" color="textMuted" style={[styles.cell, styles.tabular]}>
        {row.plan}
      </Text>
      <Text variant="bodyStrong" style={[styles.cell, styles.tabular]}>
        {row.real}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  notes: { marginTop: space.xs },
  table: { gap: space.sm },
  compare: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  label: { width: LABEL_WIDTH },
  cell: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});
