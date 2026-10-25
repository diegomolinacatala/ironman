import { StyleSheet, View } from 'react-native';

import type { DailyMetrics } from '@/domain/types';
import { Card, Icon, Text, space, useTheme, type IconName } from '@/ui';

const SOURCE_LABEL: Record<DailyMetrics['source'], string> = {
  garmin: 'Garmin',
  healthkit: 'Apple Salud',
  manual: 'Manual',
};

interface MetricItem {
  icon: IconName;
  label: string;
  value: string;
}

function metricItems(m: DailyMetrics): MetricItem[] {
  const items: (MetricItem | null)[] = [
    m.hrvMs != null ? { icon: 'heart', label: 'VFC', value: `${Math.round(m.hrvMs)} ms` } : null,
    m.restingHr != null ? { icon: 'heartOutline', label: 'FC reposo', value: `${Math.round(m.restingHr)} ppm` } : null,
    m.bodyBattery != null ? { icon: 'battery', label: 'Body Battery', value: String(Math.round(m.bodyBattery)) } : null,
    m.sleepHours != null ? { icon: 'moon', label: 'Sueño', value: `${String(Math.round(m.sleepHours * 10) / 10).replace('.', ',')} h` } : null,
    m.sleepScore != null ? { icon: 'moon', label: 'Nota sueño', value: String(Math.round(m.sleepScore)) } : null,
  ];
  return items.filter((i): i is MetricItem => i != null);
}

/** Today's device metrics with source attribution ("Datos de Garmin"). */
export function MetricsToday({ metrics }: { metrics: DailyMetrics | null }) {
  const { colors } = useTheme();
  if (!metrics) return null;
  const items = metricItems(metrics);
  if (items.length === 0) return null;
  return (
    <Card variant="tinted" padding="md" style={styles.card}>
      <View style={styles.head}>
        <Icon name="watch" size={16} color={colors.textMuted} />
        <Text variant="overline" color="textMuted">
          {`Datos de hoy · ${SOURCE_LABEL[metrics.source]}`}
        </Text>
      </View>
      <View style={styles.grid}>
        {items.map((item) => (
          <View key={item.label} style={styles.item} accessible accessibilityLabel={`${item.label}: ${item.value}`}>
            <View style={styles.head}>
              <Icon name={item.icon} size={12} color={colors.textMuted} />
              <Text variant="caption" color="textMuted">
                {item.label}
              </Text>
            </View>
            <Text variant="metricSmall">{item.value}</Text>
          </View>
        ))}
      </View>
      {metrics.source === 'garmin' ? (
        <Text variant="caption" color="textFaint">
          Garmin y Body Battery son marcas de Garmin Ltd.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  item: { minWidth: 72, gap: 2 },
});
