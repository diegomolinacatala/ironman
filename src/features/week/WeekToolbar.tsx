import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { coachButtonLabel } from '@/features/coach/aiCoachFlag';
import { Button, space } from '@/ui';

export interface WeekToolbarProps {
  weekStart: ISODate;
  /** Day new sessions / imprevistos default to (today when it is in this week, else Monday). */
  defaultDate: ISODate;
  onPlan: () => void;
  planning: boolean;
}

/**
 * Planning tools for the week: one primary action ("Planificar semana", offline rules engine),
 * the coach as secondary, and quick links to add a session or an imprevisto by hand.
 */
export function WeekToolbar({ weekStart, defaultDate, onPlan, planning }: WeekToolbarProps) {
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Button
          label="Planificar semana"
          icon="sparkles"
          onPress={onPlan}
          loading={planning}
          style={styles.flex}
          accessibilityHint="Propone sesiones para los huecos libres según tu disponibilidad y fase"
        />
        <Button
          label={coachButtonLabel()}
          icon="coach"
          variant="secondary"
          onPress={() => router.push(`/coach?mode=plan_week&weekStart=${weekStart}`)}
          style={styles.flex}
          accessibilityHint="Abre el coach para planificar la semana conversando"
        />
      </View>
      <View style={styles.row}>
        <Button
          label="Añadir entreno"
          icon="add"
          variant="ghost"
          size="sm"
          onPress={() => router.push(`/workout/edit?date=${defaultDate}`)}
          style={styles.flex}
        />
        <Button
          label="Añadir imprevisto"
          icon="eventAdd"
          variant="ghost"
          size="sm"
          onPress={() => router.push(`/event/edit?date=${defaultDate}`)}
          style={styles.flex}
          accessibilityHint="Pádel, viaje, lesión… y reorganiza la semana"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1, paddingHorizontal: space.md },
});
