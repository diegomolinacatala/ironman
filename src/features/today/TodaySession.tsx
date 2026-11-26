import { StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { Workout } from '@/domain/types';
import { SessionWeatherLine } from '@/features/weather/SessionWeatherLine';
import type { SessionWeatherView } from '@/features/weather/weatherModel';
import { timeRangeLabel } from '@/features/workouts/format';
import { Button, Card, Icon, IconButton, SportBadge, Text, radius, space, useTheme } from '@/ui';

interface TodaySessionProps {
  workout: Workout;
  partnerName: string | null;
  inCalendar: boolean;
  onOpen: () => void;
  onMore: () => void;
  busy: boolean;
  /** Weather of an outdoor session (city set): only rain at its time shows here; the rest lives in the detail. */
  weather?: SessionWeatherView | null;
}

/** The next session opens the full prescription. Its menu also lets the athlete log or adapt it. */
export function TodaySession({ workout, partnerName, inCalendar, onOpen, onMore, busy, weather = null }: TodaySessionProps) {
  const { colors } = useTheme();
  const distance = workout.distanceM ? formatDistance(workout.distanceM, workout.sport) : null;
  const time = timeRangeLabel(workout);
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="xl" style={styles.hero}>
      <View style={styles.row}>
        <SportBadge sport={workout.sport} size={40} tone="solid" />
        <View style={styles.flex}>
          <Text variant="caption" color="onAccentSoft">Tu próxima sesión</Text>
          <Text variant="bodyStrong" color="onAccentSoft">{sportLabel(workout.sport)}</Text>
        </View>
        <IconButton
          icon="more"
          size={44}
          accessibilityLabel="Opciones del entreno"
          onPress={onMore}
          disabled={busy}
        />
      </View>
      <View style={styles.summary}>
        <Text variant="display" accessibilityRole="header">{workout.title}</Text>
        <Text variant="bodyStrong" color="onAccentSoft">
          {[formatDuration(workout.durationMin), distance, time ?? 'Horario flexible'].filter(Boolean).join(' · ')}
        </Text>
        {partnerName ? <Text variant="callout" color="onAccentSoft">{`Con ${partnerName}`}</Text> : null}
        {inCalendar ? (
          <View style={styles.calendar}>
            <Icon name="calendarCheck" size={16} color={colors.onAccentSoft} />
            <Text variant="caption" color="onAccentSoft">En tu calendario</Text>
          </View>
        ) : null}
      </View>
      {weather?.onCard ? <SessionWeatherLine view={weather} /> : null}
      <Button label="Ver entreno" iconRight="arrowRight" onPress={onOpen} accessibilityHint="Ver objetivo, ritmos y estructura" fullWidth />
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  summary: { gap: space.xs },
  calendar: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
