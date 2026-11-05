import { Pressable, StyleSheet, View } from 'react-native';

import { formatDayShort, formatDuration } from '@/domain/dates';
import { Icon, Text, fonts, haptics, radius, space, useTheme } from '@/ui';

import { timeRange } from './intervals';
import { slotEdge, slotInk, slotTint } from './palette';
import type { Slot } from './types';

export interface SlotPillProps {
  slot: Slot;
  onPress?: () => void;
  /** Smaller variant for dense rows. */
  dense?: boolean;
}

/** Soft brand band for a common free slot ("Hueco"). Tap → propose a quedada there. */
export function SlotPill({ slot, onPress, dense = false }: SlotPillProps) {
  const { colors } = useTheme();
  const label = `Hueco común ${formatDayShort(slot.date)} de ${slot.start} a ${slot.end}, ${formatDuration(slot.minutes)}`;
  const content = (
    <>
      <Text variant={dense ? 'caption' : 'bodyStrong'} style={[styles.time, { color: slotInk(colors) }]}>
        {timeRange(slot.start, slot.end)}
      </Text>
      <Text variant="caption" color="textMuted">
        {formatDuration(slot.minutes)}
      </Text>
      {onPress ? <Icon name="add" size={14} color={slotEdge(colors)} weight="bold" /> : null}
    </>
  );
  const base = [
    styles.pill,
    dense && styles.dense,
    { backgroundColor: slotTint(colors), borderColor: slotEdge(colors) },
  ];
  if (!onPress) {
    return (
      <View style={base} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Propón una quedada en este hueco"
      hitSlop={dense ? 4 : undefined}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [...base, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dense: { minHeight: 36, paddingHorizontal: space.sm + 2 },
  time: { fontFamily: fonts.bodySemibold, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
});
