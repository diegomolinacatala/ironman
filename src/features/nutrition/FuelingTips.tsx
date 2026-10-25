import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { fuelingHint } from '@/domain/fueling';
import { intensityLabel } from '@/domain/labels';
import type { Workout } from '@/domain/types';
import { Card, SportBadge, Tag, Text, space, useTheme } from '@/ui';

function TipLine({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.tipLine}>
      <Text variant="overline" color="textMuted" style={styles.tipLabel}>
        {label}
      </Text>
      <Text variant="callout" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

function SessionTip({ workout }: { workout: Workout }) {
  const theme = useTheme();
  const hint = fuelingHint({ sport: workout.sport, durationMin: workout.durationMin, intensity: workout.intensity });
  return (
    <Card variant="flat" padding="md" rail={theme.sport(workout.sport).base} style={styles.card}>
      <View style={styles.head}>
        <SportBadge sport={workout.sport} size={32} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {workout.title}
          </Text>
          <Text variant="caption" color="textMuted">
            {`${formatDuration(workout.durationMin)} · ${intensityLabel(workout.intensity)}`}
          </Text>
        </View>
        {hint.carbsPerHour != null ? (
          <Tag label={`${hint.carbsPerHour} g/h`} color={theme.colors.info} tone="soft" icon="drop" />
        ) : null}
      </View>
      <TipLine label="Antes" text={hint.before} />
      {hint.during ? <TipLine label="Durante" text={hint.during} /> : null}
      <TipLine label="Después" text={hint.after} />
    </Card>
  );
}

/** Fueling guidance for the day's key sessions (general advice). */
export function FuelingTips({ workouts }: { workouts: readonly Workout[] }) {
  if (workouts.length === 0) {
    return (
      <Text variant="callout" color="textMuted">
        Hoy no hay sesiones que pidan un plan de comida especial. Come normal y bebe agua.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {workouts.map((w) => (
        <SessionTip key={w.id} workout={w} />
      ))}
      <Text variant="caption" color="textFaint">
        Orientación general, no es consejo médico. g/h = gramos de hidratos por hora.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tipLine: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  tipLabel: { width: 62, paddingTop: 3 },
  flex: { flex: 1 },
});
