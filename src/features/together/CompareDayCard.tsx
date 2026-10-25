/**
 * One day of the full compare view: two timeline tracks (me / friend) with
 * the common slots in lime, then two lanes of minis and the slot pills.
 */
import { StyleSheet, View } from 'react-native';

import { formatDayLong, weekdayOf } from '@/domain/dates';
import { weekdayShort } from '@/domain/labels';
import type { ISODate } from '@/domain/types';
import { Card, Tag, Text, space, useTheme } from '@/ui';

import { LaneMini } from './LaneMini';
import { LaneTrack, TRACK_LABEL_WIDTH, TrackAxis } from './LaneTrack';
import { slotEdge } from './palette';
import { SlotPill } from './SlotPill';
import type { CompareDay, LaneEntry, Slot } from './types';

export interface CompareDayCardProps {
  day: CompareDay;
  friendName: string;
  today: ISODate;
  onOpenWorkout: (entry: LaneEntry) => void;
  onProposeSlot: (slot: Slot) => void;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function TrackRow({ label, entries, day }: { label: string; entries: readonly LaneEntry[]; day: CompareDay }) {
  return (
    <View style={styles.trackRow}>
      <Text variant="overline" color="textMuted" numberOfLines={1} style={styles.trackLabel}>
        {label}
      </Text>
      <LaneTrack entries={entries} slots={day.slots} nowMin={day.isToday ? nowMinutes() : null} />
    </View>
  );
}

function Lane({
  entries,
  isMe,
  today,
  onOpen,
}: {
  entries: readonly LaneEntry[];
  isMe: boolean;
  today: ISODate;
  onOpen: (entry: LaneEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <Text variant="caption" color="textFaint" style={styles.free}>
        Sin planes
      </Text>
    );
  }
  return (
    <View style={styles.laneList}>
      {entries.map((entry) => (
        <LaneMini
          key={entry.key}
          entry={entry}
          isMe={isMe}
          today={today}
          onPress={isMe && entry.workout ? () => onOpen(entry) : undefined}
        />
      ))}
    </View>
  );
}

export function CompareDayCard({ day, friendName, today, onOpenWorkout, onProposeSlot }: CompareDayCardProps) {
  const { colors } = useTheme();
  const [weekday, dayNumber] = [weekdayShort(weekdayOf(day.date)), day.date.slice(8, 10)];
  return (
    <Card
      padding="md"
      variant="flat"
      style={[day.isToday && { borderColor: slotEdge(colors), borderWidth: 1.5 }, day.isPast && styles.past]}>
      <View style={styles.header} accessible accessibilityRole="header" accessibilityLabel={formatDayLong(day.date)}>
        <Text variant="overline" color="textMuted">
          {weekday}
        </Text>
        <Text variant="metricSmall">{dayNumber}</Text>
        {day.isToday ? <Tag label="Hoy" color={colors.accentInk} tone="soft" /> : null}
        <View style={styles.flex} />
        {day.slots.length > 0 ? (
          <Tag
            label={day.slots.length === 1 ? '1 hueco' : `${day.slots.length} huecos`}
            color={slotEdge(colors)}
            icon="together"
            tone="outline"
          />
        ) : null}
      </View>

      <View style={styles.tracks}>
        <TrackRow label="Yo" entries={day.mine} day={day} />
        <TrackRow label={friendName} entries={day.theirs} day={day} />
        <TrackAxis />
      </View>

      <View style={styles.lanes}>
        <View style={styles.lane}>
          <Text variant="overline" color="textFaint" style={styles.laneTitle}>
            Yo
          </Text>
          <Lane entries={day.mine} isMe today={today} onOpen={onOpenWorkout} />
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.lane}>
          <Text variant="overline" color="textFaint" numberOfLines={1} style={styles.laneTitle}>
            {friendName}
          </Text>
          <Lane entries={day.theirs} isMe={false} today={today} onOpen={onOpenWorkout} />
        </View>
      </View>

      {day.slots.length > 0 && !day.isPast ? (
        <View style={styles.slots}>
          {day.slots.map((slot) => (
            <SlotPill key={`${slot.date}-${slot.start}`} slot={slot} dense onPress={() => onProposeSlot(slot)} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  past: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  tracks: { gap: space.xs, marginTop: space.md },
  trackRow: { flexDirection: 'row', alignItems: 'center' },
  trackLabel: { width: TRACK_LABEL_WIDTH, fontSize: 10 },
  lanes: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  lane: { flex: 1, minWidth: 0 },
  laneList: { gap: space.xs },
  laneTitle: { fontSize: 10, marginBottom: space.xs },
  divider: { width: StyleSheet.hairlineWidth },
  free: { paddingVertical: space.sm },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
});
