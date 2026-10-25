import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayShort } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import { Card, Icon, SectionHeader, SportBadge, Text, space, useTheme } from '@/ui';

import { workoutA11yLabel, workoutMetaLine } from '@/features/workouts/format';

/** Compact preview of tomorrow's sessions. */
export function TomorrowStrip({ date, workouts }: { date: ISODate; workouts: Workout[] }) {
  const { colors } = useTheme();
  const training = workouts.filter((w) => w.sport !== 'rest');
  return (
    <View style={styles.root}>
      <SectionHeader title={`Mañana · ${formatDayShort(date)}`} action={{ label: 'Ver semana', onPress: () => router.push('/week') }} />
      {training.length === 0 ? (
        <Card variant="tinted" padding="md">
          <View style={styles.row}>
            <Icon name="moon" size={18} color={colors.textMuted} />
            <Text variant="callout" color="textMuted">
              Descanso. Recargar también es entrenar.
            </Text>
          </View>
        </Card>
      ) : (
        <Card padding="sm">
          {training.map((w, i) => (
            <View key={w.id}>
              {i > 0 ? <View style={[styles.sep, { backgroundColor: colors.border }]} /> : null}
              <Card
                variant="tinted"
                tint="transparent"
                padding="sm"
                onPress={() => router.push(`/workout/${w.id}`)}
                accessibilityLabel={`Mañana: ${workoutA11yLabel(w, {})}`}
                style={styles.item}>
                <View style={styles.row}>
                  <SportBadge sport={w.sport} size={30} />
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {w.title}
                    </Text>
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {workoutMetaLine(w)}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={14} color={colors.textFaint} />
                </View>
              </Card>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 30 + space.md + space.sm },
  item: { borderWidth: 0 },
});
