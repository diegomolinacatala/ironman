import { StyleSheet, View } from 'react-native';

import { addDays, formatDayLabel, formatDayLong } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { Chip, IconButton, Text, space } from '@/ui';

export interface DaySwitcherProps {
  date: ISODate;
  today: ISODate;
  onChange: (date: ISODate) => void;
}

/** ‹ Hoy › day navigation with a jump back to today. */
export function DaySwitcher({ date, today, onChange }: DaySwitcherProps) {
  const isToday = date === today;
  return (
    <View style={styles.row}>
      <IconButton icon="chevronLeft" variant="filled" accessibilityLabel="Día anterior" onPress={() => onChange(addDays(date, -1))} />
      <View style={styles.center} accessible accessibilityLabel={formatDayLong(date)} accessibilityLiveRegion="polite">
        <Text variant="title" align="center">
          {formatDayLabel(date, today)}
        </Text>
        <Text variant="caption" color="textMuted" align="center">
          {formatDayLong(date)}
        </Text>
      </View>
      <IconButton
        icon="chevronRight"
        variant="filled"
        accessibilityLabel="Día siguiente"
        disabled={date >= addDays(today, 7)}
        onPress={() => onChange(addDays(date, 1))}
      />
      {!isToday ? (
        <View style={styles.todayChip}>
          <Chip label="Hoy" icon="today" onPress={() => onChange(today)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  center: { flex: 1, gap: 0 },
  todayChip: { marginLeft: space.xs },
});
