import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { WeekSummary } from '@/domain/load';
import { SPORTS, type Sport } from '@/domain/types';
import { Card, ProgressBar, SportBadge, Text, space, useTheme } from '@/ui';

import { ComplianceDot } from '@/features/workouts/ComplianceDot';
import { complianceMeta, weekComplianceState } from '@/features/workouts/complianceMeta';

import { hoursLabel } from './weekModel';

export interface WeekTotalsProps {
  summary: WeekSummary;
  /** Target hours for this week (availability × phase volume), null if unknown. */
  targetHours: number | null;
}

/** Totals header: done vs planned hours, load, compliance and per-sport bars. */
export function WeekTotals({ summary, targetHours }: WeekTotalsProps) {
  const { colors } = useTheme();
  const state = weekComplianceState(summary.compliancePct);
  const pct = summary.compliancePct;
  const barColor = complianceMeta(state).color ?? colors.borderStrong;
  const sports = SPORTS.filter((s) => s !== 'rest' && summary.bySport[s] != null);

  return (
    <Card variant="raised" padding="lg" style={styles.card}>
      <View style={styles.top}>
        <View
          style={styles.hours}
          accessible
          accessibilityLabel={`${hoursLabel(summary.completedMin)} horas hechas de ${hoursLabel(summary.plannedMin)} planificadas`}>
          <Text variant="overline" color="textMuted">
            Horas hechas / plan
          </Text>
          <View style={styles.baseline}>
            <Text variant="display">{hoursLabel(summary.completedMin)}</Text>
            <Text variant="metricSmall" color="textMuted">{` / ${hoursLabel(summary.plannedMin)} h`}</Text>
          </View>
          {targetHours != null ? (
            <Text variant="caption" color="textMuted">
              {`Objetivo ${String(Math.round(targetHours * 10) / 10).replace('.', ',')} h`}
            </Text>
          ) : null}
        </View>
        <View
          style={styles.load}
          accessible
          accessibilityLabel={`Carga ${Math.round(summary.completedTss)} de ${Math.round(summary.plannedTss)}`}>
          <Text variant="overline" color="textMuted">
            Carga
          </Text>
          <Text variant="metric">{String(Math.round(summary.completedTss))}</Text>
          <Text variant="caption" color="textMuted">{`de ${Math.round(summary.plannedTss)}`}</Text>
        </View>
      </View>

      <View style={styles.compliance}>
        <View style={styles.complianceHead}>
          <ComplianceDot state={state} size={18} />
          <Text variant="callout" style={styles.flex}>
            {pct != null ? `${Math.round(pct * 100)}% cumplido · ${complianceMeta(state).label}` : 'Aún sin sesiones que valorar'}
          </Text>
          <Text variant="caption" color="textMuted">{`${summary.completedSessions}/${summary.sessions} sesiones`}</Text>
        </View>
        <ProgressBar value={pct ?? 0} color={barColor} height={8} />
      </View>

      {sports.length > 0 ? (
        <View style={styles.sports}>
          {sports.map((s) => (
            <SportBar key={s} sport={s} planned={summary.bySport[s]?.plannedMin ?? 0} done={summary.bySport[s]?.completedMin ?? 0} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function SportBar({ sport, planned, done }: { sport: Sport; planned: number; done: number }) {
  const theme = useTheme();
  const ratio = planned > 0 ? done / planned : done > 0 ? 1 : 0;
  return (
    <View style={styles.sportRow} accessible accessibilityLabel={`${sportLabel(sport)}: ${formatDuration(done)} de ${formatDuration(planned)}`}>
      <SportBadge sport={sport} size={24} />
      <View style={styles.flex}>
        <View style={styles.sportHead}>
          <Text variant="caption">{sportLabel(sport)}</Text>
          <Text variant="caption" color="textMuted">{`${formatDuration(done)} / ${formatDuration(planned)}`}</Text>
        </View>
        <ProgressBar value={ratio} color={theme.sport(sport).base} height={5} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  hours: { flex: 1, gap: 2 },
  baseline: { flexDirection: 'row', alignItems: 'baseline' },
  load: { alignItems: 'flex-end', gap: 2 },
  compliance: { gap: space.sm },
  complianceHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  sports: { gap: space.sm },
  sportRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sportHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
});
