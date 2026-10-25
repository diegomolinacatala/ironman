import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration, todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { complianceOf } from '@/domain/load';
import type { ISODate, Workout } from '@/domain/types';
import { Card, SportBadge, Text, space, useTheme } from '@/ui';

import { ComplianceDot } from './ComplianceDot';
import { complianceMeta } from './complianceMeta';
import { displayDurationMin, workoutA11yLabel, workoutMetaLine } from './format';
import { IntensityTag } from './IntensityTag';
import { JuntosTag, KeyTag } from './Tags';

export interface WorkoutCardProps {
  workout: Workout;
  compact?: boolean;
  today?: ISODate;
  partnerName?: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
}

/**
 * Session card with sport rail, compliance dot (colour + glyph), intensity,
 * key and "juntos" markers. `compact` is the one-row variant used in lists.
 */
export function WorkoutCard({
  workout,
  compact = false,
  today,
  partnerName,
  onPress,
  onLongPress,
}: WorkoutCardProps): JSX.Element {
  const theme = useTheme();
  const sport = theme.sport(workout.sport);
  const compliance = complianceOf(workout, today ?? todayISO());
  const isSkipped = workout.status === 'skipped';
  const label = workoutA11yLabel(workout, { partnerName, compliance: complianceMeta(compliance).label });
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
        <SportBadge sport={workout.sport} size={compact ? 34 : 42} />
        <View style={styles.body}>
          {compact ? null : (
            <Text variant="overline" color="textMuted" numberOfLines={1}>
              {sportLabel(workout.sport)}
            </Text>
          )}
          <Text variant={compact ? 'bodyStrong' : 'heading'} numberOfLines={2} style={titleStyle}>
            {workout.title}
          </Text>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {workoutMetaLine(workout)}
          </Text>
        </View>
        {compact ? null : (
          <Text variant="metricSmall" style={titleStyle}>
            {workout.sport === 'rest' ? '' : formatDuration(displayDurationMin(workout))}
          </Text>
        )}
        <ComplianceDot state={compliance} size={compact ? 18 : 22} />
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  body: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.md },
  tagsCompact: { marginTop: space.sm, marginLeft: 34 + space.md },
  skipped: { textDecorationLine: 'line-through' },
  dimmed: { opacity: 0.72 },
});
