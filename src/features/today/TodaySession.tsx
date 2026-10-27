import { Pressable, StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { Workout } from '@/domain/types';
import { timeRangeLabel, workoutA11yLabel } from '@/features/workouts/format';
import { IntensityTag } from '@/features/workouts/IntensityTag';
import { JuntosTag, KeyTag } from '@/features/workouts/Tags';
import { Button, Card, Icon, IconButton, SportBadge, Text, radius, space, useTheme } from '@/ui';

import { structureSummary } from './todayModel';

export interface TodaySessionProps {
  workout: Workout;
  partnerName: string | null;
  /** The workout is mirrored in the device calendar ("En tu calendario"). */
  inCalendar: boolean;
  onOpen: () => void;
  onComplete: () => void;
  /** Opens Saltar / Mover. */
  onMore: () => void;
  busy?: boolean;
}

function CalendarBadge() {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Está en tu calendario"
      style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
      <Icon name="calendarCheck" size={12} color={colors.textMuted} />
      <Text variant="caption" color="textMuted">
        En tu calendario
      </Text>
    </View>
  );
}

/** Today's next session: time, duration, intensity and structure in one calm card. */
export function TodaySession({ workout, partnerName, inCalendar, onOpen, onComplete, onMore, busy }: TodaySessionProps) {
  const theme = useTheme();
  const time = timeRangeLabel(workout);
  const structure = structureSummary(workout) ?? workout.description;
  return (
    <Card padding="lg" rail={theme.sport(workout.sport).base} style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Tu entreno de hoy: ${workoutA11yLabel(workout, { partnerName })}${inCalendar ? ', en tu calendario' : ''}`}
        accessibilityHint="Abre el detalle del entreno"
        onPress={onOpen}
        style={styles.body}>
        <View style={styles.top}>
          <View style={styles.flex}>
            <Text variant="overline" color="textMuted">
              {`${sportLabel(workout.sport)} · ${time ?? 'hora flexible'}`}
            </Text>
            <View style={styles.metricRow}>
              <Text variant="display">{formatDuration(workout.durationMin)}</Text>
              {workout.distanceM ? (
                <Text variant="metricSmall" color="textMuted">
                  {formatDistance(workout.distanceM, workout.sport)}
                </Text>
              ) : null}
            </View>
          </View>
          <SportBadge sport={workout.sport} size={40} />
        </View>
        <Text variant="heading" numberOfLines={2}>
          {workout.title}
        </Text>
        {structure ? (
          <Text variant="callout" color="textMuted" numberOfLines={2}>
            {structure}
          </Text>
        ) : null}
        <View style={styles.tags}>
          <IntensityTag intensity={workout.intensity} />
          {workout.isKey ? <KeyTag /> : null}
          {partnerName ? <JuntosTag name={partnerName} /> : null}
          {inCalendar ? <CalendarBadge /> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Button label="Hecho" icon="check" variant="inverse" onPress={onComplete} disabled={busy} style={styles.flex} />
        <IconButton icon="more" variant="filled" size={48} accessibilityLabel="Más opciones: saltar o mover" onPress={onMore} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  body: { gap: space.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1 },
  metricRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  actions: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
});
