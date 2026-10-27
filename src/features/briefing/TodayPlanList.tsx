import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useWorkouts } from '@/data/queries';
import type { ISODate } from '@/domain/types';
import { workoutA11yLabel, workoutMetaLine } from '@/features/workouts/format';
import { IntensityTag } from '@/features/workouts/IntensityTag';
import { workoutsOn } from '@/features/today/selectors';
import { Card, Divider, Icon, SectionHeader, SportBadge, Text, space, useTheme } from '@/ui';

import { Skeleton } from './Skeleton';

/** "Hoy": the day's sessions as a short read-only list. */
export function TodayPlanList({ date }: { date: ISODate }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const workouts = useWorkouts({ from: date, to: date });
  const training = workoutsOn(workouts.data ?? [], date).filter((w) => w.sport !== 'rest');
  // Disabled until signed in (cold start from a deep link): never show "descanso" before the first fetch.
  const settled = session != null && workouts.isFetched;

  let body;
  if (!settled || workouts.isLoading) body = <Skeleton height={56} />;
  else if (workouts.error && training.length === 0) {
    body = (
      <Text variant="callout" color="textMuted">
        No he podido cargar tu plan de hoy.
      </Text>
    );
  } else if (training.length === 0) {
    body = (
      <View style={styles.row}>
        <Icon name="moon" size={18} color={colors.textMuted} />
        <Text variant="callout" color="textMuted" style={styles.flex}>
          Hoy toca descanso. Recargar también es entrenar.
        </Text>
      </View>
    );
  } else {
    body = training.map((w, i) => (
      <View key={w.id}>
        {i > 0 ? <Divider inset={44} /> : null}
        <View style={styles.row} accessible accessibilityLabel={workoutA11yLabel(w, {})}>
          <SportBadge sport={w.sport} size={32} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={2}>
              {w.title}
            </Text>
            <Text variant="caption" color="textMuted">
              {workoutMetaLine(w)}
            </Text>
          </View>
          <IntensityTag intensity={w.intensity} />
        </View>
      </View>
    ));
  }

  return (
    <View style={styles.root}>
      <SectionHeader title="Hoy" />
      <Card padding="md">{body}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  flex: { flex: 1 },
});
