import { StyleSheet, View } from 'react-native';

import type { SleepSnapshot } from '@/domain/types';
import { Icon, Text, space, useTheme, type Theme } from '@/ui';

import { sleepFacts, type Trend } from './briefingModel';

const TREND_ROTATION: Record<Trend, string> = { up: '-90deg', down: '90deg', flat: '0deg' };

export function trendColor(trend: Trend, colors: Theme['colors']): string {
  if (trend === 'up') return colors.success;
  if (trend === 'down') return colors.warning;
  return colors.textMuted;
}

/** Small arrow for a trend (always paired with text: colour is never the only signal). */
export function TrendArrow({ trend, size = 12 }: { trend: Trend; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ transform: [{ rotate: TREND_ROTATION[trend] }] }} accessibilityElementsHidden importantForAccessibility="no">
      <Icon name="arrowRight" size={size} color={trendColor(trend, colors)} weight="bold" />
    </View>
  );
}

/** Last night in up to four numbers (hours, score, HRV vs baseline, Body Battery), 2 × 2. */
export function SleepFacts({ sleep }: { sleep: SleepSnapshot | null | undefined }) {
  const { colors } = useTheme();
  const facts = sleepFacts(sleep);
  if (facts.length === 0) return null;
  return (
    <View style={styles.grid}>
      {facts.map((fact) => (
        <View key={fact.key} style={styles.fact} accessible accessibilityLabel={fact.a11y}>
          <View style={styles.valueRow}>
            <Icon name={fact.icon} size={16} color={colors.textMuted} />
            <Text variant="metricSmall" numberOfLines={1}>
              {fact.value}
            </Text>
          </View>
          <View style={styles.labelRow}>
            {fact.trend ? <TrendArrow trend={fact.trend} /> : null}
            <Text variant="caption" color="textMuted" style={styles.label}>
              {fact.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.lg },
  fact: { flexBasis: '44%', flexGrow: 1, gap: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  label: { flexShrink: 1 },
});
