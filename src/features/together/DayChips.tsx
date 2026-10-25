import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { addDays, daysInRange, formatDayLong, weekdayOf } from '@/domain/dates';
import { weekdayShort } from '@/domain/labels';
import type { ISODate } from '@/domain/types';
import { Text, haptics, radius, space, useTheme } from '@/ui';

export interface DayChipsProps {
  value: ISODate;
  today: ISODate;
  onChange: (date: ISODate) => void;
  /** How many days from today are offered. */
  days?: number;
}

/** Horizontal day picker (today … +N), works the same on iOS and web. */
export function DayChips({ value, today, onChange, days = 21 }: DayChipsProps) {
  const { colors } = useTheme();
  const base = daysInRange({ from: today, to: addDays(today, days - 1) });
  const dates = base.includes(value) || value < today ? base : [...base, value];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} accessibilityLabel="Día">
      {dates.map((date) => {
        const selected = date === value;
        const isToday = date === today;
        return (
          <Pressable
            key={date}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={formatDayLong(date)}
            onPress={() => {
              haptics.tap();
              onChange(date);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? colors.inverseBg : pressed ? colors.surfacePressed : colors.surface,
                borderColor: selected ? colors.inverseBg : colors.border,
              },
            ]}>
            <Text variant="overline" style={{ color: selected ? colors.inverseText : colors.textMuted, fontSize: 11 }}>
              {weekdayShort(weekdayOf(date))}
            </Text>
            <Text variant="metricSmall" style={{ color: selected ? colors.inverseText : colors.text }}>
              {Number(date.slice(8, 10))}
            </Text>
            <View style={[styles.todayDot, { backgroundColor: isToday ? colors.accent : 'transparent' }]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.sm, paddingRight: space.lg },
  chip: {
    width: 54,
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: space.sm,
  },
  todayDot: { width: 6, height: 6, borderRadius: 3 },
});
