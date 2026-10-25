import { StyleSheet, View } from 'react-native';

import { formatDayLabel } from '@/domain/dates';
import { raceDistanceDetail, raceDistanceLabel } from '@/domain/labels';
import type { ISODate, Race } from '@/domain/types';
import { Card, Icon, Text, space, useTheme } from '@/ui';

import { PriorityBadge } from './PriorityBadge';
import { PRIORITY_INFO, countdown } from './raceModel';

export interface RaceRowProps {
  race: Race;
  today: ISODate;
  past?: boolean;
  onPress: () => void;
}

/** Race card: big countdown, A/B/C bib, distance + detail, place. */
export function RaceRow({ race, today, past = false, onPress }: RaceRowProps) {
  const { colors } = useTheme();
  const cd = countdown(race.date, today);
  const detail = raceDistanceDetail(race.distance);
  const label = [
    race.name,
    `${cd.spoken}`,
    formatDayLabel(race.date, today),
    `Prioridad ${race.priority}`,
    raceDistanceLabel(race.distance),
    race.location ?? '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card
      variant={race.priority === 'A' && !past ? 'raised' : 'flat'}
      padding="lg"
      rail={past ? undefined : race.priority === 'A' ? colors.text : undefined}
      onPress={onPress}
      accessibilityLabel={`${label}. Editar carrera.`}
      style={past ? styles.past : undefined}>
      <View style={styles.row}>
        <View style={styles.count}>
          <Text variant={past ? 'metric' : 'display'} color={past ? 'textMuted' : 'text'}>
            {cd.value}
          </Text>
          <Text variant="overline" color="textMuted">
            {past ? `${cd.unit} atrás` : cd.unit}
          </Text>
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <PriorityBadge priority={race.priority} size={22} />
            <Text variant="heading" numberOfLines={2} style={styles.flex}>
              {race.name}
            </Text>
          </View>
          <Text variant="caption" color="textMuted">
            {`${formatDayLabel(race.date, today)} · ${PRIORITY_INFO[race.priority].title}`}
          </Text>
          <Text variant="callout">{raceDistanceLabel(race.distance)}</Text>
          {detail ? (
            <Text variant="caption" color="textMuted">
              {detail}
            </Text>
          ) : null}
          {race.location ? (
            <View style={styles.meta}>
              <Icon name="location" size={12} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.flex}>
                {race.location}
              </Text>
            </View>
          ) : null}
          {race.goal ? (
            <View style={styles.meta}>
              <Icon name="trophy" size={12} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.flex}>
                {race.goal}
              </Text>
            </View>
          ) : null}
        </View>
        <Icon name="chevronRight" size={14} color={colors.textFaint} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  count: { width: 78, alignItems: 'flex-start' },
  info: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  past: { opacity: 0.8 },
});
