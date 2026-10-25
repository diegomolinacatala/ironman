/**
 * Horizontal day timeline for one person (06:00–22:00): sessions as sport
 * colour blocks, busy time hatched, common slots as lime bands underneath.
 */
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { timeToMinutes } from '@/domain/dates';
import { Text, radius, space, useTheme } from '@/ui';

import { Hatch } from './Hatch';
import { slotEdge, slotTint } from './palette';
import type { LaneEntry, Slot } from './types';

export const TRACK_START_MIN = 6 * 60;
export const TRACK_END_MIN = 22 * 60;
const TRACK_SPAN = TRACK_END_MIN - TRACK_START_MIN;
const AXIS_LABELS = ['06', '10', '14', '18', '22'] as const;
export const TRACK_LABEL_WIDTH = 44;

function position(startMin: number, endMin: number): { left: DimensionValue; width: DimensionValue } | null {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  const start = Math.max(TRACK_START_MIN, startMin);
  const end = Math.min(TRACK_END_MIN, endMin);
  if (end <= start) return null;
  const left = ((start - TRACK_START_MIN) / TRACK_SPAN) * 100;
  const width = Math.max(1.5, ((end - start) / TRACK_SPAN) * 100);
  return { left: `${left}%`, width: `${width}%` };
}

function entryPosition(entry: LaneEntry) {
  if (!entry.startTime || !entry.endTime) return null;
  return position(timeToMinutes(entry.startTime), timeToMinutes(entry.endTime));
}

export interface LaneTrackProps {
  entries: readonly LaneEntry[];
  slots: readonly Slot[];
  /** Minutes since midnight to draw a "now" marker (today only). */
  nowMin?: number | null;
  height?: number;
}

export function LaneTrack({ entries, slots, nowMin = null, height = 18 }: LaneTrackProps) {
  const theme = useTheme();
  const { colors } = theme;
  const nowPos = nowMin !== null ? position(nowMin, nowMin + 1) : null;
  return (
    <View
      style={[styles.track, { height, backgroundColor: colors.surfaceAlt }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {slots.map((slot) => {
        const pos = position(timeToMinutes(slot.start), timeToMinutes(slot.end));
        return pos ? (
          <View
            key={`${slot.date}-${slot.start}`}
            style={[styles.block, pos, { backgroundColor: slotTint(colors), borderColor: slotEdge(colors), borderWidth: 1 }]}
          />
        ) : null;
      })}
      {entries.map((entry) => {
        const pos = entryPosition(entry);
        if (!pos) return null;
        if (entry.kind !== 'workout') {
          return (
            <View key={entry.key} style={[styles.block, pos, styles.clip]}>
              <Hatch color={colors.borderStrong} background={colors.surface} spacing={5} />
            </View>
          );
        }
        const sport = theme.sport(entry.sport ?? 'other');
        const done = entry.status === 'completed';
        return (
          <View
            key={entry.key}
            style={[
              styles.block,
              pos,
              { backgroundColor: done ? sport.base : sport.tint, borderColor: sport.base, borderWidth: done ? 0 : 1.5 },
              entry.status === 'skipped' && styles.skipped,
            ]}
          />
        );
      })}
      {nowPos ? <View style={[styles.now, { left: nowPos.left, backgroundColor: colors.text }]} /> : null}
    </View>
  );
}

/** Hour labels aligned under tracks (06 · 10 · 14 · 18 · 22). */
export function TrackAxis({ inset = TRACK_LABEL_WIDTH }: { inset?: number }) {
  return (
    <View style={[styles.axis, { marginLeft: inset }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {AXIS_LABELS.map((label) => (
        <Text key={label} variant="caption" color="textFaint" style={styles.axisLabel}>
          {label}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flex: 1, borderRadius: radius.sm, overflow: 'hidden', position: 'relative' },
  block: { position: 'absolute', top: 0, bottom: 0, borderRadius: 4 },
  clip: { overflow: 'hidden' },
  skipped: { opacity: 0.35 },
  now: { position: 'absolute', top: -2, bottom: -2, width: 2, borderRadius: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xxs },
  axisLabel: { fontSize: 10, lineHeight: 12 },
});
