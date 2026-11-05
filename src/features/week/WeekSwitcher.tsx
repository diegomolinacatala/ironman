import { StyleSheet, View } from 'react-native';

import { addDays, formatWeekRange, isoWeekNumber } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { Chip, IconButton, Text, radius, space, useTheme } from '@/ui';

export interface WeekSwitcherProps {
  weekStart: ISODate;
  currentWeekStart: ISODate;
  onChange: (weekStart: ISODate) => void;
}

/** "Semana pasada" / "Próxima semana" / "Semana 45" under the date range. */
export function weekCaption(weekStart: ISODate, currentWeekStart: ISODate): string {
  const n = `Semana ${isoWeekNumber(weekStart)}`;
  if (weekStart === currentWeekStart) return `${n} · actual`;
  if (weekStart === addDays(currentWeekStart, 7)) return `${n} · próxima`;
  if (weekStart === addDays(currentWeekStart, -7)) return `${n} · pasada`;
  return n;
}

/** ‹ week › navigation in a quiet surface bar, with a jump back to the current week. */
export function WeekSwitcher({ weekStart, currentWeekStart, onChange }: WeekSwitcherProps) {
  const { colors } = useTheme();
  const isCurrent = weekStart === currentWeekStart;
  return (
    <View style={styles.root}>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconButton icon="chevronLeft" accessibilityLabel="Semana anterior" onPress={() => onChange(addDays(weekStart, -7))} size={44} />
        <View style={styles.center} accessibilityLiveRegion="polite">
          <Text variant="heading" align="center">
            {formatWeekRange(weekStart)}
          </Text>
          <Text variant="caption" color="textMuted" align="center">
            {weekCaption(weekStart, currentWeekStart)}
          </Text>
        </View>
        <IconButton icon="chevronRight" accessibilityLabel="Semana siguiente" onPress={() => onChange(addDays(weekStart, 7))} size={44} />
      </View>
      {isCurrent ? null : (
        <View style={styles.jump}>
          <Chip label="Volver a esta semana" icon="today" onPress={() => onChange(currentWeekStart)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  center: { flex: 1, alignItems: 'center', gap: 2 },
  jump: { alignItems: 'center' },
});
