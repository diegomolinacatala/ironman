import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayLabel, formatDayLong, formatDayMedium } from '@/domain/dates';
import { lifeEventLabel } from '@/domain/labels';
import type { ISODate, LifeEvent, RaceDistance, Thresholds, Workout } from '@/domain/types';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { Chip, Icon, IconButton, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { lifeEventIcon } from '@/features/events/kinds';
import { WorkoutCard } from '@/features/workouts/WorkoutCard';

import { dayDurationLabel, dayOpenByDefault, daySessionsLine, dayState, type DayState } from './daySummary';

export interface DaySectionProps {
  date: ISODate;
  today: ISODate;
  workouts: Workout[];
  events: LifeEvent[];
  busyText: string | null;
  partnerName: (w: Workout) => string | null;
  onLongPressWorkout: (w: Workout) => void;
  /** The athlete's thresholds: each card adds its zone and main target (omit while the profile loads). */
  thresholds?: Thresholds | null;
  /** Target race distance ("ritmo de carrera" targets). */
  raceDistance?: RaceDistance | null;
}

/** "Hoy · mié 5 nov", "Mañana · jue 6 nov", "Lun 10 nov" (sentence case). */
export function dayHeading(date: ISODate, today: ISODate): string {
  const medium = formatDayMedium(date);
  const label = formatDayLabel(date, today);
  if (label !== medium) return `${label} · ${medium}`;
  return medium.charAt(0).toUpperCase() + medium.slice(1);
}

/**
 * One day of the week list, folded to a single line (titles, time, done mark) except today;
 * open it for the busy summary, imprevistos and session cards.
 * Today sits on a soft brand panel (`accentSoft`) so it is easy to find without shouting.
 */
export function DaySection({
  date,
  today,
  workouts,
  events,
  busyText,
  partnerName,
  onLongPressWorkout,
  thresholds,
  raceDistance = null,
}: DaySectionProps) {
  const { colors } = useTheme();
  const isToday = date === today;
  const isPast = date < today;
  const [open, setOpen] = useState(() => dayOpenByDefault(date, today));
  const state = dayState(workouts, date, today);
  return (
    <View style={[styles.root, isToday && [styles.today, { backgroundColor: colors.accentSoft }]]} testID={isToday ? 'day-today' : undefined}>
      <DayHeader
        date={date}
        today={today}
        busyText={open ? busyText : null}
        isToday={isToday}
        isPast={isPast}
        open={open}
        summary={open ? null : daySessionsLine(workouts, isPast)}
        duration={dayDurationLabel(workouts)}
        state={state}
        eventCount={events.length}
        onToggle={() => setOpen(!open)}
      />
      {!open ? null : events.length > 0 ? (
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
      {!open ? null : workouts.length > 0 ? (
        <View style={styles.cards}>
          {workouts.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              compact
              today={today}
              partnerName={partnerName(w)}
              thresholds={thresholds}
              raceDistance={raceDistance}
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
  open: boolean;
  /** Session titles, shown while the day is folded. */
  summary: string | null;
  duration: string | null;
  state: DayState;
  eventCount: number;
  onToggle: () => void;
}

function StateMark({ state }: { state: DayState }) {
  const { colors } = useTheme();
  if (state === 'done') return <Icon name="checkCircle" size={16} color={colors.success} />;
  if (state === 'missed') return <Icon name="warning" size={14} color={colors.warning} />;
  return null;
}

function DayHeader({ date, today, busyText, isToday, isPast, open, summary, duration, state, eventCount, onToggle }: DayHeaderProps) {
  const { colors } = useTheme();
  const label = `${isToday ? 'Hoy, ' : ''}${formatDayLong(date)}${summary ? `. ${summary}` : ''}${duration ? `. ${duration}` : ''}`;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => {
          haptics.tap();
          onToggle();
        }}
        style={({ pressed }) => [styles.headerText, pressed && styles.pressed]}>
        <View style={styles.titleRow}>
          <Text variant="heading" color={isToday ? 'onAccentSoft' : isPast ? 'textMuted' : 'text'} style={styles.flex} numberOfLines={1}>
            {dayHeading(date, today)}
          </Text>
          <StateMark state={state} />
          {duration ? (
            <Text variant="caption" color="textMuted" style={styles.tabular}>
              {duration}
            </Text>
          ) : null}
          <View style={open ? styles.flip : undefined}>
            <Icon name="chevronDown" size={12} color={colors.textFaint} />
          </View>
        </View>
        {summary ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {eventCount > 0 ? `Imprevisto · ${summary}` : summary}
          </Text>
        ) : null}
        {busyText ? (
          <View style={styles.busy}>
            <Icon name="clock" size={12} color={colors.textMuted} />
            <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.flex}>
              {busyText}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <IconButton icon="add" accessibilityLabel={`Añadir entreno el ${formatDayLong(date)}`} onPress={() => router.push(`/workout/edit?date=${date}`)} size={36} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pressed: { opacity: 0.6 },
  flip: { transform: [{ rotate: '180deg' }] },
  tabular: { fontVariant: ['tabular-nums'] },
  today: { borderRadius: radius.lg, padding: space.md, marginHorizontal: -space.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: iconSize.lg + space.lg },
  headerText: { flex: 1, gap: 2 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1, flexShrink: 1 },
  events: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cards: { gap: space.sm },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
});
