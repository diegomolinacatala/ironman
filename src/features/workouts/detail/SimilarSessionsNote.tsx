import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { addDays } from '@/domain/dates';
import { compareWithSimilar } from '@/domain/similarSessions';
import type { Workout } from '@/domain/types';
import { useWorkouts } from '@/data/queries';
import { Icon, Text, iconSize, space, useTheme } from '@/ui';

/** Half a year is enough to find similar sessions and keeps the query light. */
const HISTORY_DAYS = 182;

/**
 * One line under the coach's verdict: this session against the athlete's similar
 * past ones ("Eficiencia un 6 % mejor que la media de tus 8 carreras parecidas").
 * Renders nothing until there are at least 3 to compare with.
 */
export function SimilarSessionsNote({ workout }: { workout: Workout }) {
  const { colors } = useTheme();
  const history = useWorkouts({ from: addDays(workout.date, -HISTORY_DAYS), to: workout.date });
  const comparison = useMemo(() => compareWithSimilar(workout, history.data ?? []), [workout, history.data]);
  if (!comparison) return null;
  const icon = comparison.deltaPct >= 3 ? 'arrowUp' : comparison.deltaPct <= -3 ? 'arrowDown' : 'check';
  return (
    <View style={styles.row} accessible accessibilityLabel={`Frente a tus sesiones parecidas: ${comparison.text}`}>
      <Icon name={icon} size={iconSize.sm} color={colors.accentInk} />
      <Text variant="callout" style={styles.text}>
        {comparison.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.xs },
  text: { flex: 1 },
});
