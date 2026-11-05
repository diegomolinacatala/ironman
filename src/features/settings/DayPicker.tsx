import { Pressable, StyleSheet, View } from 'react-native';

import { weekdayInitial, weekdayLabel } from '@/domain/labels';
import type { Weekday } from '@/domain/types';
import { Text, haptics, radius, readableTextOn, space, useTheme } from '@/ui';

import { FormLabel } from './FormLabel';

import { WEEKDAYS } from './availabilityModel';

export interface DayPickerProps {
  label: string;
  hint?: string;
  selected: readonly Weekday[];
  onToggle: (day: Weekday) => void;
  /** Days shown disabled (e.g. the rest day for long sessions). */
  disabledDays?: readonly Weekday[];
  /** Selected colour (defaults to the accent; e.g. the swim colour for pool days). */
  color?: string;
}

/** Seven round toggles, one per weekday (Mon → Sun). */
export function DayPicker({ label, hint, selected, onToggle, disabledDays = [], color }: DayPickerProps) {
  const { colors } = useTheme();
  const activeBg = color ?? colors.accent;
  const activeFg = color ? readableTextOn(color) : colors.onAccent;
  return (
    <View style={styles.wrap}>
      <FormLabel>{label}</FormLabel>
      <View style={styles.row} accessibilityRole="none">
        {WEEKDAYS.map((day) => {
          const isOn = selected.includes(day);
          const isDisabled = disabledDays.includes(day);
          return (
            <Pressable
              key={day}
              accessibilityRole="checkbox"
              accessibilityLabel={weekdayLabel(day)}
              accessibilityState={{ checked: isOn, disabled: isDisabled }}
              disabled={isDisabled}
              onPress={() => {
                haptics.tap();
                onToggle(day);
              }}
              style={({ pressed }) => [
                styles.day,
                {
                  backgroundColor: isOn ? activeBg : pressed ? colors.surfacePressed : colors.surface,
                  borderColor: isOn ? activeBg : colors.border,
                  opacity: isDisabled ? 0.35 : 1,
                },
              ]}>
              <Text variant="bodyStrong" style={{ color: isOn ? activeFg : colors.text }}>
                {weekdayInitial(day)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    maxWidth: 56,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
