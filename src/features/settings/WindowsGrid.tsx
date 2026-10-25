import { Pressable, StyleSheet, View } from 'react-native';

import { weekdayInitial, weekdayLabel } from '@/domain/labels';
import type { TrainingWindow, Weekday } from '@/domain/types';
import { Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import {
  WEEKDAYS,
  WINDOW_PRESETS,
  fillWindowsForAllDays,
  hasWindow,
  toggleWindow,
  type WindowPreset,
} from './availabilityModel';

export interface WindowsGridProps {
  windows: readonly TrainingWindow[];
  restDay: Weekday | null;
  onChange: (windows: TrainingWindow[]) => void;
}

/** Weekday × preset grid (Mañana / Mediodía / Tarde). Header taps fill or clear a whole column. */
export function WindowsGrid({ windows, restDay, onChange }: WindowsGridProps) {
  const { colors } = useTheme();
  const activeDays = WEEKDAYS.filter((d) => d !== restDay);

  const toggleColumn = (preset: WindowPreset) => {
    const allOn = activeDays.every((d) => hasWindow(windows, d, preset));
    onChange(fillWindowsForAllDays(windows, preset, allOn ? [] : activeDays));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.dayCol} />
        {WINDOW_PRESETS.map((preset) => (
          <Pressable
            key={preset.id}
            accessibilityRole="button"
            accessibilityLabel={`${preset.label}, ${preset.start} a ${preset.end}`}
            accessibilityHint="Marca o desmarca esta franja todos los días"
            onPress={() => {
              haptics.tap();
              toggleColumn(preset);
            }}
            style={({ pressed }) => [styles.head, pressed && { backgroundColor: colors.surfacePressed }]}>
            <Text variant="overline">{preset.label}</Text>
            <Text variant="caption" color="textMuted">
              {preset.start}–{preset.end}
            </Text>
          </Pressable>
        ))}
      </View>
      {WEEKDAYS.map((day) => (
        <DayRow key={day} day={day} isRest={day === restDay} windows={windows} onChange={onChange} />
      ))}
    </View>
  );
}

interface DayRowProps {
  day: Weekday;
  isRest: boolean;
  windows: readonly TrainingWindow[];
  onChange: (windows: TrainingWindow[]) => void;
}

function DayRow({ day, isRest, windows, onChange }: DayRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.dayCol}>
        <Text variant="bodyStrong" color={isRest ? 'textFaint' : 'text'}>
          {weekdayInitial(day)}
        </Text>
      </View>
      {WINDOW_PRESETS.map((preset) => {
        const isOn = hasWindow(windows, day, preset);
        return (
          <Pressable
            key={preset.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`${weekdayLabel(day)}, ${preset.label}`}
            accessibilityState={{ checked: isOn }}
            onPress={() => {
              haptics.tap();
              onChange(toggleWindow(windows, day, preset));
            }}
            style={({ pressed }) => [
              styles.cell,
              {
                backgroundColor: isOn ? colors.inverseBg : pressed ? colors.surfacePressed : colors.surface,
                borderColor: isOn ? colors.inverseBg : colors.border,
                borderStyle: isRest && !isOn ? 'dashed' : 'solid',
              },
            ]}>
            {isOn ? <Icon name="check" size={16} color={colors.inverseText} weight="bold" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayCol: { width: 28, alignItems: 'center' },
  head: { flex: 1, alignItems: 'center', paddingVertical: space.xs, borderRadius: radius.sm, minHeight: 44, justifyContent: 'center' },
  cell: { flex: 1, height: 44, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
