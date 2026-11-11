import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayLong } from '@/domain/dates';
import { raceDistanceLabel } from '@/domain/labels';
import type { SeasonOverview } from '@/domain/season';
import type { ISODate, Race } from '@/domain/types';
import { PriorityBadge } from '@/features/races/PriorityBadge';
import { Button, Card, Icon, Text, iconSize, radius, space, useTheme } from '@/ui';

import { ADD_RACE_FROM_PLAN_HREF } from './links';
import { capitalize, raceCountdown } from './seasonModel';
import { VolumeStrip } from './VolumeStrip';


export interface SeasonHeroProps {
  season: SeasonOverview;
  today: ISODate;
}

/** The only hero of Plan → General: the target race and the road to it, or the way to add one. */
export function SeasonHero({ season, today }: SeasonHeroProps) {
  return season.targetRace ? <RaceHero race={season.targetRace} season={season} today={today} /> : <NoRaceHero />;
}

function RaceHero({ race, season, today }: { race: Race; season: SeasonOverview; today: ISODate }) {
  const cd = raceCountdown(race.date, today);
  const when = `${capitalize(formatDayLong(race.date))} · ${raceDistanceLabel(race.distance)}`;
  return (
    <Card variant="raised" padding="lg" style={styles.card}>
      <View style={styles.head}>
        <Text variant="overline" color="textMuted">
          Hacia tu carrera
        </Text>
        <View style={styles.nameRow}>
          <PriorityBadge priority={race.priority} size={24} />
          <Text variant="title" accessibilityRole="header" style={styles.flex}>
            {race.name}
          </Text>
        </View>
      </View>
      <View accessible accessibilityLabel={`${cd.spoken} para ${race.name}. ${when}.`} style={styles.countdown}>
        <View style={styles.baseline}>
          <Text variant="hero">{cd.value}</Text>
          <Text variant="heading" color="textMuted">
            {cd.unit}
          </Text>
        </View>
        <Text variant="caption" color="textMuted">
          {when}
        </Text>
      </View>
      <VolumeStrip weeks={season.weeks} />
      {season.summary ? <Text variant="callout">{season.summary}</Text> : null}
      {season.warnings.map((warning) => (
        <Warning key={warning} text={warning} />
      ))}
    </Card>
  );
}

function Warning({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.warning}>
      <Icon name="info" size={iconSize.sm} color={colors.info} />
      <Text variant="caption" color="textMuted" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

function NoRaceHero() {
  const { colors } = useTheme();
  return (
    <Card variant="raised" padding="lg" style={styles.card}>
      <View style={[styles.emptyTile, { backgroundColor: colors.accentSoft }]}>
        <Icon name="flag" size={iconSize.lg} color={colors.onAccentSoft} />
      </View>
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header">
          Sin carrera a la vista
        </Text>
        <Text variant="callout" color="textMuted">
          Añade tu próxima carrera y ordenamos las semanas hasta ella: carga, descargas y afinamiento. Mientras, mantienes la forma.
        </Text>
      </View>
      <Button label="Añadir carrera" icon="add" size="lg" fullWidth onPress={() => router.push(ADD_RACE_FROM_PLAN_HREF)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  head: { gap: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  countdown: { gap: space.xxs },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  emptyTile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
