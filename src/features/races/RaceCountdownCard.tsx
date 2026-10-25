import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayLong } from '@/domain/dates';
import { raceDistanceDetail, raceDistanceLabel } from '@/domain/labels';
import type { Phase } from '@/domain/periodization';
import type { ISODate, Race } from '@/domain/types';
import { Button, Card, EmptyState, Tag, Text, space, useTheme } from '@/ui';

import { PhaseTimeline } from './PhaseTimeline';
import { PriorityBadge } from './PriorityBadge';
import { countdown, phaseName } from './raceModel';

/** Subset of domain `PhaseInfo` this card needs. */
export interface PhaseSnapshot {
  phase: Phase;
  isRecoveryWeek: boolean;
  focus: string;
}

export interface RaceCountdownCardProps {
  race: Race | null;
  phase: PhaseSnapshot | null;
  today: ISODate;
}

/** Ink "race bib" card: big countdown, race, season phase timeline. */
export function RaceCountdownCard({ race, phase, today }: RaceCountdownCardProps) {
  const { colors } = useTheme();
  if (!race) {
    return (
      <EmptyState
        icon="flag"
        title="Sin carrera a la vista"
        message="Añade tu próxima carrera y el plan se organizará por fases hacia ella."
        action={<Button label="Añadir carrera" icon="add" variant="secondary" onPress={() => router.push('/races/edit')} />}
      />
    );
  }
  const cd = countdown(race.date, today);
  const detail = raceDistanceDetail(race.distance);
  const fg = { color: colors.inverseText };
  return (
    <Card variant="inverse" padding="lg" style={styles.card} onPress={() => router.push('/races')} accessibilityLabel={`${cd.spoken} para ${race.name}. Ver carreras.`}>
      <View style={styles.top}>
        <View style={styles.count}>
          <Text variant="hero" style={[fg, styles.countValue]}>
            {cd.value}
          </Text>
          <Text variant="overline" style={[fg, styles.dim]}>
            {cd.unit}
          </Text>
        </View>
        <View style={styles.raceInfo}>
          <View style={styles.nameRow}>
            <PriorityBadge priority={race.priority} size={24} inverse />
            <Text variant="heading" style={[fg, styles.flex]} numberOfLines={2}>
              {race.name}
            </Text>
          </View>
          <Text variant="caption" style={[fg, styles.dim]}>
            {formatDayLong(race.date)}
          </Text>
          <Text variant="caption" style={[fg, styles.dim]}>
            {detail ? `${raceDistanceLabel(race.distance)} · ${detail}` : raceDistanceLabel(race.distance)}
          </Text>
        </View>
      </View>
      {phase ? (
        <>
          <PhaseTimeline phase={phase.phase} phaseName={phaseName(phase.phase)} inverse />
          <View style={styles.focusRow}>
            {phase.isRecoveryWeek ? <Tag label="Semana de descarga" color={colors.inverseText} tone="outline" /> : null}
            <Text variant="callout" style={[fg, styles.flex]}>
              {phase.focus}
            </Text>
          </View>
        </>
      ) : null}
      <Text variant="caption" style={[fg, styles.dim]}>
        Toca para ver todas tus carreras
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  top: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  count: { alignItems: 'flex-start' },
  countValue: { fontSize: 72, lineHeight: 70 },
  raceInfo: { flex: 1, gap: 4, paddingTop: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  focusRow: { gap: space.sm },
  flex: { flex: 1 },
  dim: { opacity: 0.72 },
});
