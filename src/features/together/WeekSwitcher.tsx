import { StyleSheet, View } from 'react-native';

import { addDays, formatWeekRange, isoWeekNumber, startOfWeek } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { IconButton, Text, space } from '@/ui';

export interface WeekSwitcherProps {
  weekStart: ISODate;
  today: ISODate;
  onChange: (weekStart: ISODate) => void;
}

/** ‹ SEMANA 44 · 26 oct – 1 nov › — never goes before the current week. */
export function WeekSwitcher({ weekStart, today, onChange }: WeekSwitcherProps) {
  const currentWeek = startOfWeek(today);
  const canGoBack = weekStart > currentWeek;
  const label =
    weekStart === currentWeek ? 'Esta semana' : weekStart === addDays(currentWeek, 7) ? 'Próxima semana' : `Semana ${isoWeekNumber(weekStart)}`;
  return (
    <View style={styles.row}>
      <IconButton
        icon="chevronLeft"
        accessibilityLabel="Semana anterior"
        onPress={() => onChange(addDays(weekStart, -7))}
        disabled={!canGoBack}
        size={44}
      />
      <View style={styles.center} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${label}, ${formatWeekRange(weekStart)}`}>
        <Text variant="overline" color="textMuted">
          {label}
        </Text>
        <Text variant="heading">{formatWeekRange(weekStart)}</Text>
      </View>
      <IconButton
        icon="chevronRight"
        accessibilityLabel="Semana siguiente"
        onPress={() => onChange(addDays(weekStart, 7))}
        size={44}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  center: { flex: 1, alignItems: 'center', gap: 2 },
});
