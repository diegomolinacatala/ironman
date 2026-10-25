import { StyleSheet, View } from 'react-native';

import { Card, Icon, ProgressBar, ProgressRing, Text, complianceColor, space, useTheme, type IconName } from '@/ui';

import { formatPct } from './format';
import { complianceBand, complianceBandLabel, type ComplianceBand, type VolumeWeek } from './volumeModel';

const BAND_ICON: Record<ComplianceBand, IconName> = { done: 'check', partial: 'info', off: 'warning' };

function bandColor(band: ComplianceBand): string {
  return complianceColor[band];
}

function PastWeek({ week }: { week: VolumeWeek }) {
  const { colors } = useTheme();
  const pct = week.compliancePct;
  const band = pct != null ? complianceBand(pct) : null;
  return (
    <View
      style={styles.pastRow}
      accessible
      accessibilityLabel={pct != null ? `Semana del ${week.label}: ${formatPct(pct)}, ${complianceBandLabel(band ?? 'off')}` : `Semana del ${week.label}: sin plan`}>
      <Text variant="caption" color="textMuted" style={styles.pastLabel}>
        {week.label}
      </Text>
      <View style={styles.flex}>
        <ProgressBar value={pct ?? 0} color={band ? bandColor(band) : colors.border} height={6} />
      </View>
      {band ? <Icon name={BAND_ICON[band]} size={12} color={bandColor(band)} /> : null}
      <Text variant="caption" style={styles.pastValue}>
        {pct != null ? formatPct(pct) : '—'}
      </Text>
    </View>
  );
}

/** This week's compliance ring + the previous 4 weeks. */
export function ComplianceCard({ weeks }: { weeks: readonly VolumeWeek[] }) {
  const { colors } = useTheme();
  const current = weeks.find((w) => w.isCurrent);
  const previous = weeks.filter((w) => !w.isCurrent).slice(-4).reverse();
  const pct = current?.compliancePct ?? null;
  const band = pct != null ? complianceBand(pct) : null;

  return (
    <Card variant="flat" padding="lg" style={styles.card}>
      <Text variant="overline" color="textMuted">
        Cumplimiento
      </Text>
      <View style={styles.top}>
        <ProgressRing value={pct ?? 0} size={84} stroke={9} color={band ? bandColor(band) : colors.border}>
          <Text variant="metricSmall">{pct != null ? `${Math.round(pct * 100)}` : '—'}</Text>
        </ProgressRing>
        <View style={styles.flex}>
          <Text variant="heading">Esta semana</Text>
          {band ? (
            <View style={styles.bandRow}>
              <Icon name={BAND_ICON[band]} size={14} color={bandColor(band)} />
              <Text variant="callout">{`${complianceBandLabel(band)} · ${formatPct(pct ?? 0)}`}</Text>
            </View>
          ) : (
            <Text variant="callout" color="textMuted">
              Aún no hay sesiones pasadas que medir.
            </Text>
          )}
          <Text variant="caption" color="textMuted">
            Cumplida = entre el 80 y el 120 % de lo planificado.
          </Text>
        </View>
      </View>
      <View style={styles.past}>
        {previous.map((w) => (
          <PastWeek key={w.weekStart} week={w} />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  flex: { flex: 1, gap: 4 },
  bandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  past: { gap: space.sm },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pastLabel: { width: 52 },
  pastValue: { width: 44, textAlign: 'right' },
});
