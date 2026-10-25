import { StyleSheet, View } from 'react-native';

import { sportLabel } from '@/domain/labels';
import { Card, Text, space, useTheme } from '@/ui';

import { formatHours } from './format';
import { VolumeChart } from './VolumeChart';
import { sportsInWeeks, type VolumeWeek } from './volumeModel';

function Legend({ weeks }: { weeks: readonly VolumeWeek[] }) {
  const theme = useTheme();
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {sportsInWeeks(weeks).map((sport) => (
        <View key={sport} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: theme.sport(sport).base }]} />
          <Text variant="caption" color="textMuted">
            {sportLabel(sport)}
          </Text>
        </View>
      ))}
      <View style={styles.legendItem}>
        <View style={[styles.planSwatch, { borderColor: theme.colors.borderStrong }]} />
        <Text variant="caption" color="textMuted">
          Planificado
        </Text>
      </View>
    </View>
  );
}

/** Weekly hours by sport for the last 8 weeks. */
export function VolumeCard({ weeks }: { weeks: readonly VolumeWeek[] }) {
  const current = weeks.find((w) => w.isCurrent);
  return (
    <Card variant="flat" padding="lg" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="overline" color="textMuted">
            Volumen semanal
          </Text>
          <Text variant="title">{current ? formatHours(current.completedMin) : '0 h'}</Text>
        </View>
        {current && current.plannedMin > 0 ? (
          <Text variant="caption" color="textMuted" align="right">
            {`de ${formatHours(current.plannedMin)}\nplanificadas`}
          </Text>
        ) : null}
      </View>
      <VolumeChart weeks={weeks} />
      <Legend weeks={weeks} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  flex: { flex: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  planSwatch: { width: 12, height: 10, borderRadius: 3, borderWidth: 1.25, borderStyle: 'dashed' },
});
