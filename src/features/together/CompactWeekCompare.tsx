/**
 * Week at a glance for two people: 7 columns × (Yo | friend | Huecos).
 * Sport glyphs per day, hatched cells for busy-only days, lime bars where
 * there is common free time. Tap → full compare.
 */
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { Avatar, Card, Icon, Text, radius, space, useTheme } from '@/ui';

import { totalSlotMinutes } from './compareModel';
import { Hatch } from './Hatch';
import { slotEdge, slotTint } from './palette';
import type { CompareDay, LaneEntry } from './types';

const LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
const LABEL_WIDTH = 40;
const MAX_GLYPHS = 2;

export interface CompactWeekCompareProps {
  days: readonly CompareDay[];
  myName: string;
  friendName: string;
  onPress: () => void;
}

function SportGlyph({ entry }: { entry: LaneEntry }) {
  const theme = useTheme();
  const sport = entry.sport ?? 'other';
  const c = theme.sport(sport);
  const done = entry.status === 'completed';
  return (
    <View
      style={[
        styles.glyph,
        { backgroundColor: done ? c.base : c.tint, borderColor: entry.isJoint ? slotEdge(theme.colors) : c.base },
        entry.status === 'skipped' && styles.skipped,
      ]}>
      <Icon name={sport} size={11} color={done ? '#FFFFFF' : c.base} />
    </View>
  );
}

function LaneCell({ entries }: { entries: readonly LaneEntry[] }) {
  const { colors } = useTheme();
  const workouts = entries.filter((e) => e.kind === 'workout' && e.sport !== 'rest');
  const hasBusy = entries.some((e) => e.kind !== 'workout');
  if (workouts.length === 0) {
    return (
      <View style={styles.cell}>
        {hasBusy ? (
          <View style={[styles.busyCell, { borderColor: colors.border }]}>
            <Hatch color={colors.borderStrong} background={colors.surfaceAlt} spacing={4} strokeWidth={1} />
          </View>
        ) : (
          <View style={[styles.emptyDot, { backgroundColor: colors.border }]} />
        )}
      </View>
    );
  }
  const extra = workouts.length - MAX_GLYPHS;
  return (
    <View style={styles.cell}>
      {workouts.slice(0, MAX_GLYPHS).map((entry) => (
        <SportGlyph key={entry.key} entry={entry} />
      ))}
      {extra > 0 ? (
        <Text variant="caption" color="textMuted" style={styles.extra}>
          +{extra}
        </Text>
      ) : null}
    </View>
  );
}

function SlotCell({ day }: { day: CompareDay }) {
  const { colors } = useTheme();
  const minutes = day.isPast ? 0 : totalSlotMinutes(day.slots);
  if (minutes === 0) {
    return (
      <View style={styles.cell}>
        <Text variant="caption" color="textFaint">
          –
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.cell}>
      <View style={[styles.slotBar, { backgroundColor: slotTint(colors), borderColor: slotEdge(colors) }]}>
        <Text variant="caption" style={styles.slotText} numberOfLines={1} adjustsFontSizeToFit>
          {formatDuration(minutes)}
        </Text>
      </View>
    </View>
  );
}

function summary(days: readonly CompareDay[], friendName: string): string {
  const withSlots = days.filter((d) => !d.isPast && d.slots.length > 0).length;
  const slotsText =
    withSlots === 0 ? 'sin huecos comunes' : `huecos comunes en ${withSlots} ${withSlots === 1 ? 'día' : 'días'}`;
  return `Tu semana y la de ${friendName}: ${slotsText}. Toca para ver la semana completa.`;
}

export function CompactWeekCompare({ days, myName, friendName, onPress }: CompactWeekCompareProps) {
  const { colors } = useTheme();
  return (
    <Card padding="md" variant="raised" onPress={onPress} accessibilityLabel={summary(days, friendName)}>
      <View style={styles.row}>
        <View style={styles.label} />
        {days.map((day, index) => (
          <View key={day.date} style={styles.cell}>
            <Text variant="overline" color={day.isToday ? 'text' : 'textFaint'} style={styles.letter}>
              {LETTERS[index] ?? ''}
            </Text>
            <View style={[styles.dayNumber, day.isToday && { backgroundColor: colors.accent }]}>
              <Text variant="caption" style={{ color: day.isToday ? colors.onAccent : colors.textMuted }}>
                {Number(day.date.slice(8, 10))}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.row, styles.lane]}>
        <View style={styles.label}>
          <Avatar name={myName} size={26} />
        </View>
        {days.map((day) => (
          <View key={day.date} style={[styles.column, day.isPast && styles.past]}>
            <LaneCell entries={day.mine} />
          </View>
        ))}
      </View>

      <View style={[styles.row, styles.lane]}>
        <View style={styles.label}>
          <Avatar name={friendName} size={26} color={colors.textMuted} />
        </View>
        {days.map((day) => (
          <View key={day.date} style={[styles.column, day.isPast && styles.past]}>
            <LaneCell entries={day.theirs} />
          </View>
        ))}
      </View>

      <View style={[styles.row, styles.slotsRow, { borderTopColor: colors.border }]}>
        <View style={styles.label}>
          <Icon name="together" size={16} color={slotEdge(colors)} />
        </View>
        {days.map((day) => (
          <View key={day.date} style={styles.column}>
            <SlotCell day={day} />
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text variant="caption" color="textMuted">
          Ver semana completa
        </Text>
        <Icon name="chevronRight" size={12} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  lane: { marginTop: space.sm, minHeight: 46 },
  label: { width: LABEL_WIDTH, alignItems: 'flex-start', justifyContent: 'center' },
  column: { flex: 1, alignSelf: 'stretch' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  past: { opacity: 0.45 },
  letter: { fontSize: 11 },
  dayNumber: { minWidth: 24, height: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  glyph: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  skipped: { opacity: 0.35 },
  extra: { fontSize: 10, lineHeight: 12 },
  busyCell: { width: 22, height: 30, borderRadius: 5, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  emptyDot: { width: 4, height: 4, borderRadius: 2 },
  slotsRow: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 36 },
  slotBar: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 3, height: 22, alignSelf: 'stretch', marginHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontSize: 10, lineHeight: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.xs, marginTop: space.sm },
});
