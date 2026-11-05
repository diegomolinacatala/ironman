import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayLabel, formatDayLong, formatDayMedium } from '@/domain/dates';
import { lifeEventLabel } from '@/domain/labels';
import type { ISODate, LifeEvent, Workout } from '@/domain/types';
import { Chip, Icon, IconButton, Text, iconSize, radius, space, useTheme } from '@/ui';

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

/** "Hoy · mié 5 nov", "Mañana · jue 6 nov", "Lun 10 nov" (sentence case). */
export function dayHeading(date: ISODate, today: ISODate): string {
  const medium = formatDayMedium(date);
  const label = formatDayLabel(date, today);
  if (label !== medium) return `${label} · ${medium}`;
  return medium.charAt(0).toUpperCase() + medium.slice(1);
}

/**
 * One day of the week list: header, busy summary, imprevistos and sessions.
 * Today sits on a soft brand panel (`accentSoft`) so it is easy to find without shouting.
 */
export function DaySection({ date, today, workouts, events, busyText, partnerName, onLongPressWorkout }: DaySectionProps) {
  const { colors } = useTheme();
  const isToday = date === today;
  const isPast = date < today;
  return (
    <View style={[styles.root, isToday && [styles.today, { backgroundColor: colors.accentSoft }]]} testID={isToday ? 'day-today' : undefined}>
      <DayHeader date={date} today={today} busyText={busyText} isToday={isToday} isPast={isPast} />
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
        <View style={[styles.empty, { borderColor: colors.border, backgroundColor: isToday ? colors.surface : 'transparent' }]}>
          <Text variant="caption" color="textMuted">
            {isPast ? 'Sin sesiones' : 'Libre'}
          </Text>
        </View>
      )}
    </View>
  );
}

interface DayHeaderProps {
  date: ISODate;
  today: ISODate;
  busyText: string | null;
  isToday: boolean;
  isPast: boolean;
}

function DayHeader({ date, today, busyText, isToday, isPast }: DayHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerText} accessible accessibilityRole="header" accessibilityLabel={`${isToday ? 'Hoy, ' : ''}${formatDayLong(date)}`}>
        <Text variant="heading" color={isToday ? 'onAccentSoft' : isPast ? 'textMuted' : 'text'}>
          {dayHeading(date, today)}
        </Text>
        {busyText ? (
          <View style={styles.busy}>
            <Icon name="clock" size={12} color={colors.textMuted} />
            <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.flex}>
              {busyText}
            </Text>
          </View>
        ) : null}
      </View>
      <IconButton icon="add" accessibilityLabel={`Añadir entreno el ${formatDayLong(date)}`} onPress={() => router.push(`/workout/edit?date=${date}`)} size={36} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  today: { borderRadius: radius.lg, padding: space.md, marginHorizontal: -space.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: iconSize.lg + space.lg },
  headerText: { flex: 1, gap: 2 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flexShrink: 1 },
  events: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cards: { gap: space.sm },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
});
