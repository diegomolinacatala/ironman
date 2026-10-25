import { StyleSheet, View } from 'react-native';

import { formatDayLong, formatDistance, formatDuration } from '@/domain/dates';
import { difficultyLabel, intensityLabel, sportLabel } from '@/domain/labels';
import { estimateTss } from '@/domain/load';
import type { Workout } from '@/domain/types';
import { SportBadge, Text, intensityColor, space, useTheme } from '@/ui';

import { timeRangeLabel, workoutStatusLabel } from '../format';
import { JuntosTag, KeyTag } from '../Tags';
import { MetricGrid, MetricTile } from './MetricTile';

export function WorkoutHeader({ workout, partnerName }: { workout: Workout; partnerName: string | null }) {
  const theme = useTheme();
  const status = workoutStatusLabel(workout);
  const time = timeRangeLabel(workout);
  return (
    <View style={styles.header}>
      <View style={[styles.rail, { backgroundColor: theme.sport(workout.sport).base }]} />
      <View style={styles.headerBody}>
        <View style={styles.headerTop}>
          <SportBadge sport={workout.sport} size={48} tone="solid" />
          <View style={styles.flex}>
            <Text variant="overline" color="textMuted">
              {status ? `${sportLabel(workout.sport)} · ${status}` : sportLabel(workout.sport)}
            </Text>
            <Text variant="title" accessibilityRole="header">
              {workout.title}
            </Text>
          </View>
        </View>
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
    </View>
  );
}

export function WorkoutMetrics({ workout }: { workout: Workout }) {
  if (workout.sport === 'rest') return null;
  const load = Math.round(workout.tss ?? estimateTss(workout));
  return (
    <MetricGrid>
      <MetricTile label="Duración" value={formatDuration(workout.durationMin)} />
      <MetricTile
        label="Distancia"
        value={workout.distanceM != null && workout.distanceM > 0 ? formatDistance(workout.distanceM, workout.sport) : '—'}
      />
      <MetricTile label="Carga estimada" value={String(load)} />
      <MetricTile label="Intensidad" value={intensityLabel(workout.intensity)} accent={intensityColor[workout.intensity]} />
      <MetricTile label="Dificultad" value={difficultyLabel(workout.intensity)} />
    </MetricGrid>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: space.md },
  rail: { width: 5, borderRadius: 3 },
  headerBody: { flex: 1, gap: space.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
