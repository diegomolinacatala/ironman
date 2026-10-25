import { StyleSheet, View } from 'react-native';

import { formatDecimal } from '@/features/progress/format';
import { Text, radius, space, useTheme } from '@/ui';

import type { DayTotals } from './nutritionModel';

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.total}>
      <Text variant="metricSmall">{value}</Text>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
    </View>
  );
}

/** Daily macro totals (only rendered when some entry has macros). */
export function DayTotalsBar({ totals }: { totals: DayTotals }) {
  const { colors } = useTheme();
  if (!totals.hasMacros) return null;
  const label = `Total del día: ${Math.round(totals.kcal)} kilocalorías, ${Math.round(totals.carbsG)} gramos de hidratos, ${Math.round(totals.proteinG)} de proteína y ${Math.round(totals.fatG)} de grasa.`;
  return (
    <View style={[styles.bar, { backgroundColor: colors.surfaceAlt }]} accessible accessibilityLabel={label}>
      <Total label="kcal" value={`${Math.round(totals.kcal)}`} />
      <Total label="Hidratos" value={`${formatDecimal(totals.carbsG, 0)} g`} />
      <Total label="Proteína" value={`${formatDecimal(totals.proteinG, 0)} g`} />
      <Total label="Grasa" value={`${formatDecimal(totals.fatG, 0)} g`} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  total: { alignItems: 'flex-start', gap: 0 },
});
