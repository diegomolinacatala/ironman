import { StyleSheet, View } from 'react-native';

import { mealLabel } from '@/domain/labels';
import type { NutritionLog, UUID } from '@/domain/types';
import { formatDecimal } from '@/features/progress/format';
import { Card, Divider, IconButton, Text, space } from '@/ui';

import type { SlotGroup } from './nutritionModel';

function macrosText(log: NutritionLog): string | null {
  const parts = [
    log.kcal != null ? `${Math.round(log.kcal)} kcal` : null,
    log.carbsG != null ? `${formatDecimal(log.carbsG)} g HC` : null,
    log.proteinG != null ? `${formatDecimal(log.proteinG)} g prot.` : null,
    log.fatG != null ? `${formatDecimal(log.fatG)} g grasa` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface MealGroupProps {
  group: SlotGroup;
  deletingId: UUID | null;
  onDelete: (log: NutritionLog) => void;
}

/** One meal slot ("Desayuno") with its entries. */
export function MealGroup({ group, deletingId, onDelete }: MealGroupProps) {
  return (
    <View style={styles.group}>
      <Text variant="overline" color="textMuted" accessibilityRole="header">
        {mealLabel(group.slot)}
      </Text>
      <Card variant="flat" padding="sm">
        {group.entries.map((log, i) => {
          const macros = macrosText(log);
          return (
            <View key={log.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[styles.row, deletingId === log.id && styles.deleting]}>
                <View style={styles.text}>
                  <Text variant="body">{log.description}</Text>
                  {macros ? (
                    <Text variant="caption" color="textMuted">
                      {macros}
                    </Text>
                  ) : null}
                </View>
                <IconButton
                  icon="trash"
                  accessibilityLabel={`Borrar «${log.description}»`}
                  disabled={deletingId === log.id}
                  onPress={() => onDelete(log)}
                  size={44}
                />
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.sm, paddingVertical: space.xs },
  text: { flex: 1, gap: 2 },
  deleting: { opacity: 0.4 },
});
