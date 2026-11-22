import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { useActionSheet } from '@/features/workouts/actionSheet';
import { Button, space } from '@/ui';

export interface WeekToolbarProps {
  weekStart: ISODate;
  /** Day new sessions / imprevistos default to (today when it is in this week, else Monday). */
  defaultDate: ISODate;
  onPlan: () => void;
  planning: boolean;
}

/**
 * Planning tools for the week, kept to one row: the primary "Planificar semana" (offline rules
 * engine, fills the free calendar time) and "Añadir" (entreno or imprevisto). Talking to the
 * coach lives in the coach bar, always at hand.
 */
export function WeekToolbar({ weekStart: _weekStart, defaultDate, onPlan, planning }: WeekToolbarProps) {
  const sheet = useActionSheet();
  return (
    <View style={styles.row}>
      <Button
        label="Planificar semana"
        icon="sparkles"
        onPress={onPlan}
        loading={planning}
        style={styles.flex}
        accessibilityHint="Propone sesiones en los huecos libres de tu calendario según tu fase"
      />
      <Button
        label="Añadir"
        icon="add"
        variant="secondary"
        onPress={() =>
          sheet.open({
            title: 'Añadir a tu semana',
            actions: [
              { label: 'Entreno', icon: 'add', onPress: () => router.push(`/workout/edit?date=${defaultDate}`) },
              { label: 'Imprevisto (pádel, viaje, lesión…)', icon: 'eventAdd', onPress: () => router.push(`/event/edit?date=${defaultDate}`) },
            ],
          })
        }
        accessibilityHint="Añade un entreno o un imprevisto y reorganiza la semana"
      />
      {sheet.element}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1, paddingHorizontal: space.md },
});
