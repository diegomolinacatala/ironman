import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, radius, space, useTheme } from '@/ui';

export interface MetricTileProps {
  label: string;
  value: string;
  /** Small text under the value (unit, comparison…). */
  hint?: string;
  accent?: string;
}

/** Big condensed number with an overline label (race-bib style). */
export function MetricTile({ label, value, hint, accent }: MetricTileProps) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}
      style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="overline" color="textMuted" numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.valueRow}>
        {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
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

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  accent: { width: 4, height: 18, borderRadius: 2 },
  value: { flexShrink: 1 },
});
