import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ListRow, Text, space, useTheme } from '@/ui';

import { DayTotalsBar } from './DayTotalsBar';
import type { DayTotals } from './nutritionModel';

export interface NutritionSummaryCardProps {
  /** Today's totals, or null while loading / unavailable. */
  totals: DayTotals | null;
  entries: number;
}

function entriesText(entries: number): string {
  if (entries === 0) return 'Nada apuntado todavía';
  return entries === 1 ? '1 comida apuntada' : `${entries} comidas apuntadas`;
}

/** Progreso → Nutrición: today's totals and the way into the full log. */
export function NutritionSummaryCard({ totals, entries }: NutritionSummaryCardProps) {
  const { colors } = useTheme();
  const summary = entriesText(entries);
  return (
    <Card variant="flat" padding="md" style={styles.card}>
      <ListRow
        icon="food"
        iconTint={colors.accentSoft}
        iconColor={colors.onAccentSoft}
        title="Lo que has comido hoy"
        subtitle={summary}
        onPress={() => router.push('/nutrition')}
      />
      {totals ? <DayTotalsBar totals={totals} /> : null}
      {entries === 0 ? (
        <Text variant="caption" color="textMuted">
          Apunta lo que comes y tu coach lo tendrá en cuenta en tus sesiones clave.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label="Foto de tu comida"
          icon="camera"
          variant="secondary"
          size="sm"
          accessibilityHint="Haz una foto y calculo calorías y macros"
          onPress={() => router.push('/meal?source=camera')}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  actions: { flexDirection: 'row' },
});
