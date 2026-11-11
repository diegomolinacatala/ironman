import { Pressable, StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { sessionFeel, targetSummary } from '@/domain/prescription';
import type { RaceDistance, Thresholds, Workout } from '@/domain/types';
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
  /** Opens No es mi día / Mover / Saltar. */
  onMore: () => void;
  busy?: boolean;
  /** The athlete's thresholds: the target line in ppm / pace / watts (RPE without them). */
  thresholds?: Thresholds | null;
  raceDistance?: RaceDistance | null;
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

/** Main set + targets ("3×8' Z4 · 162–168 ppm · RPE 7–8") and how it should feel: the card's highlight (accentSoft). */
function TargetWell({ target, feel }: { target: string; feel: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.well, { backgroundColor: colors.accentSoft }]}>
      <View style={styles.wellRow}>
        <Icon name="target" size={16} color={colors.onAccentSoft} />
        <Text variant="callout" color="onAccentSoft" style={[styles.flex, styles.tabular]}>
          {target}
        </Text>
      </View>
      {feel ? (
        <Text variant="caption" color="onAccentSoft" numberOfLines={2}>
          {feel}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Today's next session — the one primary action on Hoy ("Hecho"). Raised card with the sport
 * rail; time, duration, the coach's objective, the target line, how it should feel and the
 * structure in one calm block.
 */
export function TodaySession({
  workout,
  partnerName,
  inCalendar,
  onOpen,
  onComplete,
  onMore,
  busy,
  thresholds = null,
  raceDistance = null,
}: TodaySessionProps) {
  const theme = useTheme();
  const time = timeRangeLabel(workout);
  const lead = workout.coaching?.objective?.trim() || workout.description?.trim() || null;
  const target = targetSummary(workout, thresholds, { raceDistance });
  const feel = target ? sessionFeel(workout, thresholds, { raceDistance }) : '';
  const structure = structureSummary(workout);
  const a11y = [`Tu entreno de hoy: ${workoutA11yLabel(workout, { partnerName })}`, inCalendar ? 'en tu calendario' : '', lead ?? '', target ?? '']
    .filter(Boolean)
    .join('. ');
  return (
    <Card variant="raised" padding="lg" rail={theme.sport(workout.sport).base} style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint="Abre el detalle del entreno" onPress={onOpen} style={styles.body}>
        <View style={styles.top}>
          <View style={styles.flex}>
            <Text variant="overline" color="textMuted">
              {`${sportLabel(workout.sport)} · ${time ?? 'hora flexible'}`}
            </Text>
            <View style={styles.metricRow}>
              <Text variant="metric">{formatDuration(workout.durationMin)}</Text>
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
        {lead ? (
          <Text variant="callout" numberOfLines={2}>
            {lead}
          </Text>
        ) : null}
        {target ? <TargetWell target={target} feel={feel} /> : null}
        {structure ? (
          <Text variant="caption" color="textMuted" numberOfLines={2}>
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
        <Button label="Hecho" icon="check" onPress={onComplete} disabled={busy} style={styles.flex} />
        <IconButton
          icon="more"
          variant="filled"
          size={48}
          accessibilityLabel="Más opciones: no es mi día, mover o saltar"
          onPress={onMore}
          disabled={busy}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  body: { gap: space.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  metricRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' },
  well: { borderRadius: radius.md, padding: space.md, gap: space.xs },
  wellRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
});
