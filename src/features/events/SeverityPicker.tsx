import { Pressable, StyleSheet, View } from 'react-native';

import { severityLabel } from '@/domain/labels';
import type { LifeEventKind, Severity } from '@/domain/types';
import { Icon, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { SEVERITIES } from './kinds';

export interface SeverityPickerProps {
  kind: LifeEventKind;
  value: Severity;
  onChange: (s: Severity) => void;
  label: string;
}

/**
 * Three radio rows with a level meter and the domain's descriptive label. Selection matches
 * `KindGrid`: `accentSoft` row, `accent` border, `onAccentSoft` content and a check mark.
 */
export function SeverityPicker({ kind, value, onChange, label }: SeverityPickerProps) {
  return (
    <View style={styles.root} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {SEVERITIES.map((s) => (
        <SeverityRow key={s} level={s} text={severityLabel(kind, s)} selected={s === value} onPress={() => onChange(s)} />
      ))}
    </View>
  );
}

function SeverityRow({ level, text, selected, onPress }: { level: Severity; text: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const fg = selected ? colors.onAccentSoft : colors.text;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={text}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
      ]}>
      <View style={styles.meter}>
        {SEVERITIES.map((n) => (
          <View
            key={n}
            style={[styles.bar, { height: 6 + n * 4, backgroundColor: n <= level ? (selected ? colors.accentInk : colors.textMuted) : colors.borderStrong }]}
          />
        ))}
      </View>
      <Text variant="callout" style={[styles.text, { color: fg }]}>
        {text}
      </Text>
      {selected ? <Icon name="checkCircle" size={iconSize.md} color={colors.accentInk} /> : <View style={styles.checkSpace} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  meter: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, width: 22 },
  bar: { width: 5, borderRadius: 1 },
  text: { flex: 1 },
  checkSpace: { width: iconSize.md },
});
