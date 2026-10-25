import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayLabel, formatDayLong } from '@/domain/dates';
import { lifeEventLabel } from '@/domain/labels';
import type { ISODate, LifeEvent, Workout } from '@/domain/types';
import { Chip, Icon, IconButton, Text, radius, space, useTheme } from '@/ui';

import { lifeEventIcon } from '@/features/events/kinds';
import { WorkoutCard } from '@/features/workouts/WorkoutCard';

export interface DaySectionProps {
  date: ISODate;
  today: ISODate;
  workouts: Workout[];
  events: LifeEvent[];
  busyText: string | null;
  partnerName: (w: Workout) => string | null;
  onLongPressWorkout: (w: Workout) => void;
}

/** One day of the week list: header, busy summary, imprevistos and sessions. */
export function DaySection({ date, today, workouts, events, busyText, partnerName, onLongPressWorkout }: DaySectionProps) {
  const { colors } = useTheme();
  const isToday = date === today;
  const isPast = date < today;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={[styles.marker, { backgroundColor: isToday ? colors.accent : 'transparent' }]} />
        <View style={styles.headerText} accessible accessibilityRole="header" accessibilityLabel={`${isToday ? 'Hoy, ' : ''}${formatDayLong(date)}`}>
          <Text variant="overline" color={isToday ? 'text' : isPast ? 'textFaint' : 'textMuted'}>
            {formatDayLabel(date, today)}
          </Text>
          {busyText ? (
            <View style={styles.busy}>
              <Icon name="clock" size={11} color={colors.textFaint} />
              <Text variant="caption" color="textFaint" numberOfLines={1}>
                {busyText}
              </Text>
            </View>
          ) : null}
        </View>
        <IconButton icon="add" accessibilityLabel={`Añadir entreno el ${formatDayLong(date)}`} onPress={() => router.push(`/workout/edit?date=${date}`)} size={40} />
      </View>
      {events.length > 0 ? (
        <View style={styles.events}>
          {events.map((e) => (
            <Chip
              key={e.id}
              label={e.title || lifeEventLabel(e.kind)}
              icon={lifeEventIcon(e.kind)}
              onPress={() => router.push(`/event/edit?id=${e.id}&date=${e.startDate}`)}
            />
          ))}
        </View>
      ) : null}
      {workouts.length > 0 ? (
        <View style={styles.cards}>
          {workouts.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              compact
              today={today}
              partnerName={partnerName(w)}
              onPress={() => router.push(`/workout/${w.id}`)}
              onLongPress={() => onLongPressWorkout(w)}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text variant="caption" color="textFaint">
            {isPast ? 'Sin sesiones' : 'Libre'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  marker: { width: 4, alignSelf: 'stretch', borderRadius: radius.pill, minHeight: 20 },
  headerText: { flex: 1, gap: 2 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  events: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cards: { gap: space.sm },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
});
