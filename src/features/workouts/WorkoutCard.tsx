import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration, todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { complianceOf } from '@/domain/load';
import type { ISODate, RaceDistance, Thresholds, Workout } from '@/domain/types';
import { Card, Icon, SportBadge, Text, space, useTheme } from '@/ui';

import { ComplianceDot } from './ComplianceDot';
import { complianceMeta } from './complianceMeta';
import { displayDurationMin, workoutA11yLabel, workoutMetaLine } from './format';
import { IntensityTag } from './IntensityTag';
import { JuntosTag, KeyTag } from './Tags';
import { cardTargetCaption } from './targets';

export interface WorkoutCardProps {
  workout: Workout;
  compact?: boolean;
  today?: ISODate;
  partnerName?: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * The athlete's thresholds. When passed (null = none set), the card adds a compact
   * caption with the zone and main target ("Z4 · 162–168 ppm").
   */
  thresholds?: Thresholds | null;
  /** Target race distance (what "ritmo de carrera" means). */
  raceDistance?: RaceDistance | null;
}

/**
 * Session card: sport rail + tinted sport badge, title (`heading`), meta caption, optional
 * target caption, compliance dot (colour + glyph), intensity, key and "juntos" markers.
 * `compact` is the list variant.
 */
export function WorkoutCard({
  workout,
  compact = false,
  today,
  partnerName,
  onPress,
  onLongPress,
  thresholds,
  raceDistance = null,
}: WorkoutCardProps): JSX.Element {
  const theme = useTheme();
  const sport = theme.sport(workout.sport);
  const compliance = complianceOf(workout, today ?? todayISO());
  const isSkipped = workout.status === 'skipped';
  const target = thresholds !== undefined && !isSkipped ? cardTargetCaption(workout, thresholds, { raceDistance }) : null;
  const label = workoutA11yLabel(workout, { partnerName, compliance: complianceMeta(compliance).label, target });
  const titleStyle = isSkipped ? styles.skipped : undefined;

  return (
    <Card
      onPress={onPress}
      onLongPress={onLongPress}
      rail={isSkipped ? theme.colors.borderStrong : sport.base}
      padding={compact ? 'md' : 'lg'}
      accessibilityLabel={label}
      style={isSkipped ? styles.dimmed : undefined}>
      <View style={styles.row}>
        <SportBadge sport={workout.sport} size={compact ? BADGE_COMPACT : 40} />
        <View style={styles.body}>
          {compact ? null : (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {sportLabel(workout.sport)}
            </Text>
          )}
          <Text variant="heading" numberOfLines={2} style={titleStyle}>
            {workout.title}
          </Text>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {workoutMetaLine(workout)}
          </Text>
          {target ? (
            <View style={styles.target}>
              <Icon name="target" size={12} color={theme.colors.textMuted} />
              <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.targetText}>
                {target}
              </Text>
            </View>
          ) : null}
        </View>
        {compact ? null : (
          <Text variant="metricSmall" style={titleStyle}>
            {workout.sport === 'rest' ? '' : formatDuration(displayDurationMin(workout))}
          </Text>
        )}
        <ComplianceDot state={compliance} size={compact ? 20 : 22} />
      </View>
      <CardTags workout={workout} partnerName={partnerName} compact={compact} />
    </Card>
  );
}

function CardTags({
  workout,
  partnerName,
  compact,
}: {
  workout: Workout;
  partnerName?: string | null;
  compact: boolean;
}): JSX.Element | null {
  const showIntensity = !compact && workout.sport !== 'rest';
  if (!showIntensity && !workout.isKey && !partnerName) return null;
  return (
    <View style={[styles.tags, compact ? styles.tagsCompact : null]}>
      {showIntensity ? <IntensityTag intensity={workout.intensity} /> : null}
      {workout.isKey ? <KeyTag /> : null}
      {partnerName ? <JuntosTag name={partnerName} /> : null}
    </View>
  );
}

const BADGE_COMPACT = 36;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  body: { flex: 1, gap: 2 },
  target: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  targetText: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.md },
  tagsCompact: { marginTop: space.sm, marginLeft: BADGE_COMPACT + space.md },
  skipped: { textDecorationLine: 'line-through' },
  dimmed: { opacity: 0.72 },
});
