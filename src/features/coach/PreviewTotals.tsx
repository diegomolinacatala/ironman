import { StyleSheet, View } from 'react-native';

import { formatHours, formatInt, formatSigned } from '@/features/progress/format';
import { Text, radius, space, useTheme } from '@/ui';

import type { PreviewResult, WeekTotals } from './proposalDiff';

interface MetricProps {
  label: string;
  before: string;
  after: string;
  delta: string | null;
}

function Metric({ label, before, after, delta }: MetricProps) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: antes ${before}, después ${after}`}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      <View style={styles.values}>
        {before !== after ? (
          <Text variant="callout" color="textFaint" style={styles.strike}>
            {before}
          </Text>
        ) : null}
        <Text variant="metric">{after}</Text>
      </View>
      <Text variant="caption" color="textMuted">
        {delta ?? 'Sin cambio'}
      </Text>
    </View>
  );
}

function deltaMinutes(a: WeekTotals, b: WeekTotals): string | null {
  const d = b.minutes - a.minutes;
  if (Math.abs(d) < 1) return null;
  return `${d > 0 ? '+' : '−'}${formatHours(Math.abs(d))}`;
}

function deltaLoad(a: WeekTotals, b: WeekTotals): string | null {
  const d = b.load - a.load;
  return Math.abs(d) < 1 ? null : formatSigned(d);
}

/** "Antes → Después" of the week if the selected changes are applied. */
export function PreviewTotals({ preview, selectedCount }: { preview: PreviewResult; selectedCount: number }) {
  const { colors } = useTheme();
  const { before, after } = preview;
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="overline" color="textMuted">
        {selectedCount === 0 ? 'Sin cambios seleccionados' : 'Tu semana si aplicas'}
      </Text>
      <View style={styles.grid}>
        <Metric label="Horas" before={formatHours(before.minutes)} after={formatHours(after.minutes)} delta={deltaMinutes(before, after)} />
        <Metric label="Carga" before={formatInt(before.load)} after={formatInt(after.load)} delta={deltaLoad(before, after)} />
        <Metric
          label="Sesiones"
          before={`${before.sessions}`}
          after={`${after.sessions}`}
          delta={after.sessions !== before.sessions ? formatSigned(after.sessions - before.sessions) : null}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  grid: { flexDirection: 'row', gap: space.lg },
  metric: { flex: 1, gap: 2 },
  values: { gap: 0 },
  strike: { textDecorationLine: 'line-through' },
});
