import { StyleSheet, View } from 'react-native';

import { Card, EmptyState, Text, radius, space, useTheme } from '@/ui';

import { chartPalette } from './chartPalette';
import { formatInt, spokenInt } from './format';
import { PmcChart } from './PmcChart';
import { DISPLAY_WEEKS, interpretFreshness, rampText, type PmcSeries } from './pmcModel';

interface StatProps {
  label: string;
  value: string;
  color: string;
  swatch: 'line' | 'bar';
  big?: boolean;
}

function Stat({ label, value, color, swatch, big = false }: StatProps) {
  return (
    <View style={styles.stat}>
      <View style={styles.statLabel}>
        <View style={[swatch === 'line' ? styles.swatchLine : styles.swatchBar, { backgroundColor: color }]} />
        <Text variant="overline" color="textMuted" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text variant={big ? 'hero' : 'display'}>{value}</Text>
    </View>
  );
}

/** Hero card: latest Forma física / Fatiga / Frescura + chart + reading. */
export function PmcCard({ series }: { series: PmcSeries }) {
  const theme = useTheme();
  const palette = chartPalette(theme);
  const latest = series.latest;

  if (!series.hasData || !latest) {
    return (
      <EmptyState
        icon="progress"
        title="Aún no hay carga registrada"
        message="Completa entrenos o conecta Garmin o Apple Salud y aquí verás tu forma física, tu fatiga y tu frescura."
      />
    );
  }
  const reading = interpretFreshness(latest.tsb);
  return (
    <Card variant="raised" padding="lg" style={styles.card}>
      <View style={styles.stats} accessible accessibilityLabel={`Hoy: forma física ${spokenInt(latest.ctl)}, fatiga ${spokenInt(latest.atl)}, frescura ${spokenInt(latest.tsb)}`}>
        <Stat label="Forma física" value={formatInt(latest.ctl)} color={palette.fitness} swatch="line" big />
        <Stat label="Fatiga" value={formatInt(latest.atl)} color={palette.fatigue} swatch="line" />
        <Stat label="Frescura" value={formatInt(latest.tsb)} color={latest.tsb >= 0 ? palette.freshPositive : palette.freshNegative} swatch="bar" />
      </View>
      <Text variant="caption" color="textMuted">
        {`${rampText(series.rampWeek)} · últimas ${DISPLAY_WEEKS} semanas y 2 de plan (discontinuo)`}
      </Text>
      <PmcChart series={series} />
      <View style={[styles.reading, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Text variant="callout">{reading.text}</Text>
      </View>
      {series.seeded ? (
        <Text variant="caption" color="textMuted">
          Llevas pocas semanas de datos: el punto de partida es una estimación con tus primeras semanas.
        </Text>
      ) : null}
      <Text variant="caption" color="textFaint">
        Forma física: media de tu carga de 6 semanas. Fatiga: de 7 días. Frescura: la diferencia entre ambas.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: space.lg },
  stat: { gap: 0, flexShrink: 1 },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatchLine: { width: 14, height: 3, borderRadius: 2 },
  swatchBar: { width: 8, height: 10, borderRadius: 2 },
  reading: { borderRadius: radius.md, padding: space.md },
});
