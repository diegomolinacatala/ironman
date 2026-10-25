/**
 * "Ese día": what overlaps with the proposed quedada for me and each invitee,
 * plus the common free slots of that day (tap one to use its start time).
 */
import { StyleSheet, View } from 'react-native';

import { formatDayLabel, startOfWeek, weekRange } from '@/domain/dates';
import { commonSlots, friendBusyIntervals } from '@/domain/together';
import type { DateRange, Friend, ISODate, ISOTime, Sport, UUID, Workout } from '@/domain/types';
import { useBusyBlocks, useFriendWeek, useProfile, useWorkouts } from '@/data/queries';
import { firstName } from '@/features/social/friendModel';
import { errorMessage, logger } from '@/lib/logger';
import { Card, Icon, Loading, Text, space, useTheme, type IconName } from '@/ui';

import { futureSlots } from './compareModel';
import {
  conflictMessage,
  findConflicts,
  friendDayEntries,
  isSameSportMatch,
  matchMessage,
  myDayEntries,
  sameDayMessage,
  type ConflictReport,
} from './conflicts';
import { busySegments, DEFAULT_FRIEND_WINDOWS, myBusyIntervals, windowsOrDefault } from './intervals';
import { slotEdge } from './palette';
import { SlotPill } from './SlotPill';
import type { BusySegment, Interval, Slot } from './types';

const MIN_FIT_MINUTES = 15;

export interface ConflictPreviewProps {
  date: ISODate;
  today: ISODate;
  startTime: ISOTime | null;
  durationMin: number;
  sport: Sport;
  invitees: readonly Friend[];
  /** My workout being converted into the quedada (not a conflict with itself). */
  excludeWorkoutId: UUID | null;
  onPickTime: (time: ISOTime) => void;
}

type LineTone = 'warning' | 'info' | 'success' | 'match';

const LINE_ICON: Record<LineTone, IconName> = { warning: 'warning', info: 'info', success: 'checkCircle', match: 'together' };

function Line({ tone, text }: { tone: LineTone; text: string }) {
  const { colors } = useTheme();
  const icon = LINE_ICON[tone];
  const color = {
    warning: colors.warning,
    info: colors.textMuted,
    success: colors.success,
    match: slotEdge(colors),
  }[tone];
  return (
    <View style={styles.line}>
      <Icon name={icon} size={14} color={color} />
      <Text variant="callout" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

interface ReportLinesProps {
  report: ConflictReport;
  who: { isMe: boolean; name: string };
  timed: boolean;
  sport: Sport;
}

function ReportLines({ report, who, timed, sport }: ReportLinesProps) {
  const free = who.isMe ? 'Estás libre a esa hora' : `${who.name} está libre a esa hora`;
  return (
    <>
      {report.overlaps.map((entry, i) =>
        !who.isMe && isSameSportMatch(entry, sport) ? (
          <Line key={`o${i}`} tone="match" text={matchMessage(entry, who.name)} />
        ) : (
          <Line key={`o${i}`} tone="warning" text={conflictMessage(entry, who)} />
        ),
      )}
      {report.sameDay.map((entry, i) => (
        <Line key={`s${i}`} tone="info" text={sameDayMessage(entry, who)} />
      ))}
      {timed && report.overlaps.length === 0 ? <Line tone="success" text={free} /> : null}
    </>
  );
}

interface MineContext {
  range: DateRange;
  myBusy: Interval[];
  windows: ReturnType<typeof windowsOrDefault>;
}

function daySlots(date: ISODate, mine: MineContext, friendItems: Parameters<typeof friendBusyIntervals>[0], minMinutes: number): Slot[] {
  try {
    const slots = commonSlots({
      range: { from: date, to: date },
      mine: { busy: mine.myBusy, windows: mine.windows },
      theirs: { busy: friendBusyIntervals(friendItems), windows: [...DEFAULT_FRIEND_WINDOWS] },
      minMinutes,
    });
    return futureSlots(slots, new Date(), minMinutes);
  } catch (error) {
    logger.warn('conflict preview: slots failed', error);
    return [];
  }
}

function FriendDay({ friend, props, mine }: { friend: Friend; props: ConflictPreviewProps; mine: MineContext }) {
  const week = useFriendWeek(friend.profile.id, mine.range);
  const name = firstName(friend.profile.displayName);
  if (week.isLoading) return <Loading label={`Mirando la agenda de ${name}`} />;
  if (week.error) {
    return <Line tone="info" text={errorMessage(week.error, `No se ha podido ver la agenda de ${name}.`)} />;
  }
  const items = week.data ?? [];
  const report = findConflicts(friendDayEntries(props.date, items), props.startTime, props.durationMin);
  const slots = daySlots(props.date, mine, items, Math.max(MIN_FIT_MINUTES, props.durationMin));
  return (
    <View style={styles.person}>
      <Text variant="overline" color="textMuted">
        {name}
      </Text>
      <ReportLines report={report} who={{ isMe: false, name }} timed={Boolean(props.startTime)} sport={props.sport} />
      {slots.length > 0 ? (
        <View style={styles.slots}>
          <Text variant="caption" color="textMuted">
            Libres los dos:
          </Text>
          <View style={styles.pills}>
            {slots.map((slot) => (
              <SlotPill key={slot.start} slot={slot} dense onPress={() => props.onPickTime(slot.start)} />
            ))}
          </View>
        </View>
      ) : (
        <Line tone="info" text={`Ese día no coincidís en un hueco de ${props.durationMin}' o más.`} />
      )}
    </View>
  );
}

function workoutsForSlots(workouts: readonly Workout[], exclude: UUID | null): Workout[] {
  return workouts.filter((w) => w.id !== exclude);
}

export function ConflictPreview(props: ConflictPreviewProps) {
  const range = weekRange(startOfWeek(props.date));
  const profile = useProfile();
  const workouts = useWorkouts(range);
  const blocks = useBusyBlocks(range);
  const loading = workouts.isLoading || blocks.isLoading;
  const segments: BusySegment[] = busySegments(blocks.data ?? [], range).filter((s) => s.date === props.date);
  const mineWorkouts = workoutsForSlots(workouts.data ?? [], props.excludeWorkoutId);
  const mine: MineContext = {
    range,
    myBusy: myBusyIntervals(segments, mineWorkouts.filter((w) => w.date === props.date)),
    windows: windowsOrDefault(profile.data?.availability.windows),
  };
  const report = findConflicts(
    myDayEntries(props.date, workouts.data ?? [], segments, props.excludeWorkoutId),
    props.startTime,
    props.durationMin,
  );

  return (
    <Card padding="lg" variant="flat">
      <Text variant="overline" color="textMuted" accessibilityRole="header">
        {formatDayLabel(props.date, props.today)} · así estáis
      </Text>
      {loading ? (
        <Loading />
      ) : (
        <View style={styles.person}>
          <Text variant="overline" color="textMuted">
            Tú
          </Text>
          <ReportLines report={report} who={{ isMe: true, name: 'Tú' }} timed={Boolean(props.startTime)} sport={props.sport} />
        </View>
      )}
      {props.invitees.map((friend) => (
        <FriendDay key={friend.friendshipId} friend={friend} props={props} mine={mine} />
      ))}
      {!props.startTime ? (
        <Text variant="caption" color="textMuted" style={styles.hint}>
          Sin hora: elige un hueco común o escribe una hora para ver solapes.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  person: { gap: space.xs, marginTop: space.md },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
  slots: { gap: space.xs, marginTop: space.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { marginTop: space.md },
});
