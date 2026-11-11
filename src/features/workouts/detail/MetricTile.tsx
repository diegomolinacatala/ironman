import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, radius, space, useTheme } from '@/ui';

export interface MetricTileProps {
  label: string;
  value: string;
  /** Small text under the value (unit, comparison…). */
  hint?: string;
  /** Identity colour shown as a dot before the value (e.g. intensity zone). */
  accent?: string;
  /** Takes the whole row (long values such as "162–168 ppm aprox."). */
  wide?: boolean;
}

/** Number tile: muted sentence-case label over a tabular `metricSmall` value. */
export function MetricTile({ label, value, hint, accent, wide = false }: MetricTileProps) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}
      style={[styles.tile, wide ? styles.wide : null, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.valueRow}>
        {accent ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
        <Text variant="metricSmall" numberOfLines={1} adjustsFontSizeToFit style={styles.value}>
          {value}
        </Text>
      </View>
      {hint ? (
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const DOT = 10;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space.xs,
  },
  wide: { flexBasis: '100%' },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  value: { flexShrink: 1 },
});
