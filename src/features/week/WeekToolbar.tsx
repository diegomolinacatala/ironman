import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { coachButtonLabel } from '@/features/coach/aiCoachFlag';
import { Button, space } from '@/ui';

export interface WeekToolbarProps {
  weekStart: ISODate;
  onPlan: () => void;
  planning: boolean;
}

/** "Planificar semana" (offline rules engine) + the coach ("Coach IA" when the AI coach is on). */
export function WeekToolbar({ weekStart, onPlan, planning }: WeekToolbarProps) {
  return (
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
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1, paddingHorizontal: space.md },
});
