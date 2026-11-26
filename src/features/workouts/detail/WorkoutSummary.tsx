import { StyleSheet, View } from 'react-native';

import { formatDayLong, formatDistance, formatDuration } from '@/domain/dates';
import { difficultyLabel, intensityLabel, sportLabel } from '@/domain/labels';
import { estimateTss } from '@/domain/load';
import type { RaceDistance, Thresholds, Workout } from '@/domain/types';
import { Card, SportBadge, Text, intensityColor, space, useTheme } from '@/ui';

import { displayDurationMin, timeRangeLabel, workoutStatusLabel } from '../format';
import { JuntosTag, KeyTag } from '../Tags';
import { mainTargetTile } from '../targets';
import { MetricGrid, MetricTile } from './MetricTile';

export function WorkoutHeader({ workout, partnerName }: { workout: Workout; partnerName: string | null }) {
  const status = workoutStatusLabel(workout);
  const time = timeRangeLabel(workout);
  const tint = useTheme().sport(workout.sport).tint;
  return (
    <Card variant="tinted" tint={tint} padding="lg">
      <View style={styles.headerBody}>
        <View style={styles.headerTop}>
          <SportBadge sport={workout.sport} size={48} />
          <View style={styles.flex}>
            <Text variant="caption" color="textMuted">
              {status ? `${sportLabel(workout.sport)} · ${status}` : sportLabel(workout.sport)}
            </Text>
            <Text variant="title" accessibilityRole="header">
              {workout.title}
            </Text>
          </View>
        </View>
        {workout.sport !== 'rest' ? (
          <View style={styles.highlights}>
            <Text variant="metric">{formatDuration(displayDurationMin(workout))}</Text>
            <Text variant="callout" color="textMuted">{intensityLabel(workout.intensity)}</Text>
          </View>
        ) : null}
        <Text variant="callout" color="textMuted">
          {time ? `${formatDayLong(workout.date)} · ${time}` : `${formatDayLong(workout.date)} · hora flexible`}
        </Text>
        {workout.isKey || partnerName ? (
          <View style={styles.tags}>
            {workout.isKey ? <KeyTag /> : null}
            {partnerName ? <JuntosTag name={partnerName} /> : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export interface WorkoutMetricsProps {
  workout: Workout;
  thresholds: Thresholds | null;
  raceDistance: RaceDistance | null;
}

/** Main target (wide tile, derived from the zones when the plan has no explicit targets) + plan numbers. */
export function WorkoutMetrics({ workout, thresholds, raceDistance }: WorkoutMetricsProps) {
  if (workout.sport === 'rest') return null;
  const load = Math.round(workout.tss ?? estimateTss(workout));
  const target = mainTargetTile(workout, thresholds, { raceDistance });
  return (
    <MetricGrid>
      {target ? (
        <MetricTile wide label={target.label} value={target.value} hint={target.hint ?? undefined} accent={intensityColor[target.intensity]} />
      ) : null}
      <MetricTile label="Duración" value={formatDuration(workout.durationMin)} />
      {workout.distanceM != null && workout.distanceM > 0 ? <MetricTile label="Distancia" value={formatDistance(workout.distanceM, workout.sport)} /> : null}
      <MetricTile label="Carga" value={String(load)} />
      <MetricTile label="Intensidad" value={intensityLabel(workout.intensity)} accent={intensityColor[workout.intensity]} />
      <MetricTile label="Dificultad" value={difficultyLabel(workout.intensity)} />
    </MetricGrid>
  );
}

const styles = StyleSheet.create({
  highlights: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.sm },
  headerBody: { gap: space.md },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
