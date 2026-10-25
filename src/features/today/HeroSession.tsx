import { Pressable, StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { Workout } from '@/domain/types';
import { Button, Card, SportBadge, Text, space, useTheme } from '@/ui';

import { timeRangeLabel, workoutA11yLabel } from '@/features/workouts/format';
import { IntensityTag } from '@/features/workouts/IntensityTag';
import { JuntosTag, KeyTag } from '@/features/workouts/Tags';

export interface HeroSessionProps {
  workout: Workout;
  partnerName: string | null;
  onOpen: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onMove: () => void;
  busy?: boolean;
}

/** Ink "race bib" card for the next session of the day with quick actions. */
export function HeroSession({ workout, partnerName, onOpen, onComplete, onSkip, onMove, busy }: HeroSessionProps) {
  const theme = useTheme();
  const { colors } = theme;
  const time = timeRangeLabel(workout);
  const muted = { color: colors.inverseText, opacity: 0.7 };
  return (
    <Card variant="inverse" rail={theme.sport(workout.sport).base} padding="lg" style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Próxima sesión: ${workoutA11yLabel(workout, { partnerName })}`}
        accessibilityHint="Abre el detalle del entreno"
        onPress={onOpen}
        style={styles.body}>
        <View style={styles.top}>
          <Text variant="overline" style={muted}>
            {`Próxima · ${time ?? 'hora flexible'}`}
          </Text>
          <SportBadge sport={workout.sport} size={40} tone="solid" />
        </View>
        <View style={styles.metricRow}>
          <Text variant="hero" style={{ color: colors.inverseText }}>
            {formatDuration(workout.durationMin)}
          </Text>
          {workout.distanceM ? (
            <Text variant="metricSmall" style={muted}>
              {formatDistance(workout.distanceM, workout.sport)}
            </Text>
          ) : null}
        </View>
        <Text variant="heading" style={{ color: colors.inverseText }} numberOfLines={2}>
          {workout.title}
        </Text>
        <Text variant="caption" style={muted}>
          {sportLabel(workout.sport)}
        </Text>
        <View style={styles.tags}>
          <IntensityTag intensity={workout.intensity} />
          {workout.isKey ? <KeyTag onInverse /> : null}
          {partnerName ? <JuntosTag name={partnerName} /> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Button label="Hecho" icon="check" onPress={onComplete} style={styles.primary} disabled={busy} />
        <Button label="Saltar" icon="skip" variant="secondary" onPress={onSkip} disabled={busy} style={styles.flex} />
        <Button label="Mover" icon="move" variant="secondary" onPress={onMove} disabled={busy} style={styles.flex} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  body: { gap: space.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, marginTop: space.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.sm },
  primary: { flex: 1.3, paddingHorizontal: space.md },
  flex: { flex: 1, paddingHorizontal: space.md },
});
