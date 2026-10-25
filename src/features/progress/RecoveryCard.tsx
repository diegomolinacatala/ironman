import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, Text, space, useTheme } from '@/ui';

import {
  RECOVERY_DAYS,
  attributionText,
  deltaText,
  formatRecoveryValue,
  recoverySummary,
  sourceLabel,
  type RecoverySeries,
} from './recoveryModel';
import { Sparkline } from './Sparkline';

const SERIES_COLOR: Record<RecoverySeries['key'], 'info' | 'text' | 'textMuted'> = {
  hrvMs: 'info',
  restingHr: 'text',
  sleepHours: 'textMuted',
};

function MetricRow({ series, showSource }: { series: RecoverySeries; showSource: boolean }) {
  const { colors } = useTheme();
  const color = colors[SERIES_COLOR[series.key]];
  const delta = deltaText(series.deltaPct);
  return (
    <View style={styles.row} accessible accessibilityLabel={recoverySummary(series)}>
      <View style={styles.valueCol}>
        <Text variant="overline" color="textMuted">
          {series.label}
        </Text>
        <View style={styles.valueRow}>
          <Text variant="metric">{series.latest != null ? formatRecoveryValue(series, series.latest) : '—'}</Text>
          <Text variant="caption" color="textMuted">
            {series.unit}
          </Text>
        </View>
        <Text variant="caption" color="textFaint">
          {delta ?? 'Sin datos'}
        </Text>
        {showSource && series.sources.length > 0 ? (
          <Text variant="caption" color="textFaint">
            {series.sources.map(sourceLabel).join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={styles.sparkCol}>
        <Sparkline values={series.values} average={series.average} color={color} />
      </View>
    </View>
  );
}

/** VFC, FC en reposo y sueño of the last 28 days. */
export function RecoveryCard({ series }: { series: readonly RecoverySeries[] }) {
  const hasAny = series.some((s) => s.latest != null);
  const attribution = attributionText(series);
  // Per-row sources only matter when the card mixes Garmin and Salud.
  const mixed = new Set(series.flatMap((s) => s.sources)).size > 1;
  return (
    <Card variant="flat" padding="lg" style={styles.card}>
      <View style={styles.head}>
        <Text variant="overline" color="textMuted">
          {`Últimos ${RECOVERY_DAYS} días`}
        </Text>
        {attribution ? (
          <Text variant="caption" color="textFaint">
            {attribution}
          </Text>
        ) : null}
      </View>
      {hasAny ? (
        series.map((s, i) => (
          <View key={s.key} style={styles.item}>
            {i > 0 ? <Divider /> : null}
            <MetricRow series={s} showSource={mixed} />
          </View>
        ))
      ) : (
        <View style={styles.empty}>
          <Text variant="callout" color="textMuted">
            Conecta Garmin o Apple Salud para ver tu VFC, tu pulso en reposo y tu sueño.
          </Text>
          <Button label="Conexiones" icon="link" size="sm" variant="secondary" onPress={() => router.push('/settings/integrations')} />
        </View>
      )}
      {hasAny ? (
        <Text variant="caption" color="textFaint">
          Línea discontinua: tu media del periodo.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  item: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  valueCol: { width: 136, gap: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  sparkCol: { flex: 1 },
  empty: { gap: space.md, alignItems: 'flex-start' },
});
