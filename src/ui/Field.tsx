import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { haptics } from './haptics';
import { Icon } from './Icon';
import { Text } from './Text';
import { fonts, radius, space, useTheme } from './theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, multiline, onFocus, onBlur, accessibilityLabel, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      {label ? (
        <Text variant="overline" color="textMuted">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accentInk}
        {...rest}
        multiline={multiline}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={rest.accessibilityHint ?? (error || hint || undefined)}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : focused ? colors.text : colors.border,
          },
        ]}
      />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              haptics.tap();
              onChange(option.value);
            }}
            style={[styles.segment, selected && { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="caption" color={selected ? 'text' : 'textMuted'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Formats the displayed value, e.g. minutes → "1h 15'". */
  format?: (value: number) => string;
  label?: string;
}

export function Stepper({ value, onChange, step = 5, min = 0, max = 1000, format, label }: StepperProps) {
  const { colors } = useTheme();
  const set = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) {
      haptics.tap();
      onChange(clamped);
    }
  };
  return (
    <View style={styles.field}>
      {label ? (
        <Text variant="overline" color="textMuted">
          {label}
        </Text>
      ) : null}
      <View style={[styles.stepper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable accessibilityLabel="Restar" accessibilityRole="button" onPress={() => set(value - step)} hitSlop={8} style={styles.stepBtn}>
          <Icon name="chevronLeft" size={18} color={colors.text} />
        </Pressable>
        <Text variant="metricSmall" accessibilityLiveRegion="polite">
          {format ? format(value) : String(value)}
        </Text>
        <Pressable accessibilityLabel="Sumar" accessibilityRole="button" onPress={() => set(value + step)} hitSlop={8} style={styles.stepBtn}>
          <Icon name="chevronRight" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

export interface ScorePickerProps {
  label: string;
  value: number | null;
  onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
  /** Labels for 1 and 5, e.g. ["Fatal", "Genial"]. */
  ends: [string, string];
  /** When true, 5 is bad (fatigue, stress) and colours invert. */
  inverted?: boolean;
}

export function ScorePicker({ label, value, onChange, ends, inverted = false }: ScorePickerProps) {
  const { colors } = useTheme();
  const scale = [colors.danger, colors.warning, '#B9C23A', colors.success, colors.success];
  return (
    <View style={styles.field}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      <View style={styles.scoreRow}>
        {([1, 2, 3, 4, 5] as const).map((n) => {
          const selected = value === n;
          const tone = scale[inverted ? 5 - n : n - 1];
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${n} de 5`}
              accessibilityState={{ selected }}
              onPress={() => {
                haptics.tap();
                onChange(n);
              }}
              style={[
                styles.score,
                { borderColor: selected ? tone : colors.border, backgroundColor: selected ? tone : colors.surface },
              ]}>
              <Text variant="metricSmall" style={{ color: selected ? '#FFFFFF' : colors.text }}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.scoreEnds}>
        <Text variant="caption" color="textFaint">
          {ends[0]}
        </Text>
        <Text variant="caption" color="textFaint">
          {ends[1]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  segment: {
    flex: 1,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.md,
    height: 52,
    paddingHorizontal: space.sm,
  },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scoreRow: { flexDirection: 'row', gap: space.sm },
  score: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  scoreEnds: { flexDirection: 'row', justifyContent: 'space-between' },
});
