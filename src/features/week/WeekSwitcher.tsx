import { StyleSheet, View } from 'react-native';

import { addDays, formatWeekRange, isoWeekNumber } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { Chip, IconButton, Text, space } from '@/ui';

export interface WeekSwitcherProps {
  weekStart: ISODate;
  currentWeekStart: ISODate;
  onChange: (weekStart: ISODate) => void;
}

/** ‹ week › navigation with a jump back to the current week. */
export function WeekSwitcher({ weekStart, currentWeekStart, onChange }: WeekSwitcherProps) {
  const isCurrent = weekStart === currentWeekStart;
  const relative =
    weekStart === addDays(currentWeekStart, 7) ? 'Próxima semana' : weekStart === addDays(currentWeekStart, -7) ? 'Semana pasada' : null;
  return (
    <View style={styles.root}>
      <IconButton icon="chevronLeft" variant="filled" accessibilityLabel="Semana anterior" onPress={() => onChange(addDays(weekStart, -7))} size={44} />
      <View style={styles.center} accessibilityLiveRegion="polite">
        <Text variant="overline" color="textMuted">
          {isCurrent ? `Esta semana · S${isoWeekNumber(weekStart)}` : (relative ?? `Semana ${isoWeekNumber(weekStart)}`)}
        </Text>
        <Text variant="heading">{formatWeekRange(weekStart)}</Text>
      </View>
      {isCurrent ? null : <Chip label="Esta semana" icon="today" onPress={() => onChange(currentWeekStart)} />}
      <IconButton icon="chevronRight" variant="filled" accessibilityLabel="Semana siguiente" onPress={() => onChange(addDays(weekStart, 7))} size={44} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  center: { flex: 1, alignItems: 'center', gap: 2 },
});
