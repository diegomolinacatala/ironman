/**
 * Compact entry inside a lane column: sport rail + time + title/duration.
 * Busy time renders hatched ("Ocupado"); masked titles read "Entreno".
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { complianceOf } from '@/domain/load';
import type { ISODate } from '@/domain/types';
import { ComplianceDot } from '@/features/workouts/ComplianceDot';
import { Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import { Hatch } from './Hatch';
import { timeRange } from './intervals';
import { slotEdge } from './palette';
import type { LaneEntry } from './types';

export interface LaneMiniProps {
  entry: LaneEntry;
  isMe: boolean;
  today: ISODate;
  onPress?: () => void;
}

function timeText(entry: LaneEntry): string {
  if (entry.startTime && entry.endTime && entry.kind !== 'workout') return timeRange(entry.startTime, entry.endTime);
  return entry.startTime ?? 'Sin hora';
}

function titleText(entry: LaneEntry, isMe: boolean): string {
  if (entry.kind === 'busy') return isMe && entry.title ? entry.title : 'Ocupado';
  if (entry.kind === 'event') return entry.title ?? 'Plan';
  if (entry.sport === 'rest') return entry.title ?? 'Descanso';
  return entry.title ?? 'Entreno';
}

function BusyMini({ entry, isMe }: { entry: LaneEntry; isMe: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.mini, styles.busy, { borderColor: colors.border }]}>
      <Hatch color={colors.border} background={colors.surfaceAlt} spacing={7} />
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {timeText(entry)}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        {titleText(entry, isMe)}
      </Text>
    </View>
  );
}

export function LaneMini({ entry, isMe, today, onPress }: LaneMiniProps) {
  const theme = useTheme();
  const { colors } = theme;
  if (entry.kind === 'busy') return <BusyMini entry={entry} isMe={isMe} />;

  const sport = theme.sport(entry.sport ?? 'other');
  const title = titleText(entry, isMe);
  const duration = entry.durationMin ? formatDuration(entry.durationMin) : null;
  const compliance = entry.workout ? complianceOf(entry.workout, today) : null;
  const label = [timeText(entry), title, duration, entry.isJoint ? 'quedada' : null].filter(Boolean).join(', ');

  const body = (
    <>
      <View style={[styles.rail, { backgroundColor: sport.base }]} />
      <View style={styles.topRow}>
        <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.flex}>
          {timeText(entry)}
          {duration ? ` · ${duration}` : ''}
        </Text>
        {compliance && compliance !== 'pending' ? <ComplianceDot state={compliance} size={14} /> : null}
        {entry.isJoint ? <Icon name="together" size={12} color={slotEdge(colors)} /> : null}
      </View>
      <Text
        variant="callout"
        numberOfLines={2}
        style={[entry.status === 'skipped' && styles.skipped, !entry.title && { color: colors.textMuted }]}>
        {title}
      </Text>
    </>
  );

  const surface = { backgroundColor: sport.tint, borderColor: entry.isJoint ? slotEdge(colors) : 'transparent' };
  if (!onPress) {
    return (
      <View style={[styles.mini, surface]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.mini, surface, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mini: {
    borderRadius: radius.sm,
    paddingVertical: space.xs + 2,
    paddingLeft: space.sm + 4,
    paddingRight: space.sm,
    gap: 1,
    overflow: 'hidden',
    borderWidth: 1,
    minHeight: 44,
  },
  busy: { paddingLeft: space.sm, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
  skipped: { textDecorationLine: 'line-through', opacity: 0.6 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
