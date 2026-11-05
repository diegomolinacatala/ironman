import { StyleSheet, View } from 'react-native';

import { Card, EmptyState, Text, radius, space, useTheme } from '@/ui';

import { chartPalette, type ChartPalette } from './chartPalette';
import { formatInt, spokenInt } from './format';
import { PmcChart } from './PmcChart';
import { DISPLAY_WEEKS, interpretFreshness, rampText, type PmcSeries } from './pmcModel';

type Swatch = 'line' | 'thinLine' | 'bar' | 'dashed';

interface StatProps {
  label: string;
  value: string;
  color: string;
  swatch: Swatch;
  big?: boolean;
}

function SwatchMark({ kind, color }: { kind: Swatch; color: string }) {
  if (kind === 'dashed') return <View style={[styles.swatchDashed, { borderColor: color }]} />;
  const shape = kind === 'bar' ? styles.swatchBar : kind === 'thinLine' ? styles.swatchThin : styles.swatchLine;
  return <View style={[shape, { backgroundColor: color }]} />;
}

function Stat({ label, value, color, swatch, big = false }: StatProps) {
  return (
    <View style={styles.stat}>
      <View style={styles.statLabel}>
        <SwatchMark kind={swatch} color={color} />
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text variant={big ? 'hero' : 'metric'} style={big ? styles.tabular : undefined}>
        {value}
      </Text>
    </View>
  );
}

/** Mark + name of every series, so the chart never relies on colour alone. */
function Legend({ palette }: { palette: ChartPalette }) {
  const items: { label: string; kind: Swatch; color: string }[] = [
    { label: 'Forma física', kind: 'line', color: palette.fitness },
    { label: 'Fatiga', kind: 'thinLine', color: palette.fatigue },
    { label: 'Frescura', kind: 'bar', color: palette.freshPositive },
    { label: 'Plan', kind: 'dashed', color: palette.axis },
  ];
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <SwatchMark kind={item.kind} color={item.color} />
          <Text variant="caption" color="textMuted">
            {item.label}
          </Text>
        </View>
      ))}
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
      <Card variant="flat" padding="md">
        <EmptyState
          icon="progress"
          title="Aún no hay carga registrada"
          message="Completa entrenos o conecta Garmin o Apple Salud y aquí verás tu forma física, tu fatiga y tu frescura."
        />
      </Card>
    );
  }
  const reading = interpretFreshness(latest.tsb);
  return (
    <Card variant="raised" padding="lg" style={styles.card}>
      <View style={styles.stats} accessible accessibilityLabel={`Hoy: forma física ${spokenInt(latest.ctl)}, fatiga ${spokenInt(latest.atl)}, frescura ${spokenInt(latest.tsb)}`}>
        <Stat label="Forma física" value={formatInt(latest.ctl)} color={palette.fitness} swatch="line" big />
        <Stat label="Fatiga" value={formatInt(latest.atl)} color={palette.fatigue} swatch="thinLine" />
        <Stat label="Frescura" value={formatInt(latest.tsb)} color={latest.tsb >= 0 ? palette.freshPositive : palette.freshNegative} swatch="bar" />
      </View>
      <Text variant="caption" color="textMuted">
        {`${rampText(series.rampWeek)} · últimas ${DISPLAY_WEEKS} semanas y 2 de plan`}
      </Text>
      <PmcChart series={series} />
      <Legend palette={palette} />
      <View style={[styles.reading, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Text variant="callout">{reading.text}</Text>
      </View>
      {series.seeded ? (
        <Text variant="caption" color="textMuted">
          Llevas pocas semanas de datos: el punto de partida es una estimación con tus primeras semanas.
        </Text>
      ) : null}
      <Text variant="caption" color="textMuted">
        Forma física: media de tu carga de 6 semanas. Fatiga: de 7 días. Frescura: la diferencia entre ambas.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xl },
  stat: { gap: space.xxs, flexShrink: 1 },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabular: { fontVariant: ['tabular-nums'] },
  swatchLine: { width: 14, height: 3, borderRadius: 2 },
  swatchThin: { width: 14, height: 2, borderRadius: 1 },
  swatchBar: { width: 8, height: 10, borderRadius: 2 },
  swatchDashed: { width: 14, height: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reading: { borderRadius: radius.md, padding: space.md },
});
