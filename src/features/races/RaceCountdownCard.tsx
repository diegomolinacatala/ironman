import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDayLong } from '@/domain/dates';
import { raceDistanceLabel } from '@/domain/labels';
import type { Phase } from '@/domain/periodization';
import type { ISODate, Race } from '@/domain/types';
import { SEASON_HREF } from '@/features/season/links';
import { Button, Card, Icon, ListRow, Tag, Text, haptics, radius, space, useTheme } from '@/ui';

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

const openRaces = () => router.push('/races');
/** Plan → General (switches tab: `navigate`, never `push`). */
const openSeason = () => router.navigate(SEASON_HREF);

function CountdownTile({ value, unit }: { value: string; unit: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
      <Text variant="metricSmall" color="onAccentSoft" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" color="onAccentSoft" numberOfLines={1}>
        {unit}
      </Text>
    </View>
  );
}

function PhaseBlock({ phase }: { phase: PhaseSnapshot }) {
  const { colors } = useTheme();
  return (
    <View style={styles.phase}>
      <PhaseTimeline phase={phase.phase} phaseName={phaseName(phase.phase)} />
      {phase.isRecoveryWeek ? <Tag label="Descarga" color={colors.info} tone="soft" icon="moon" /> : null}
      <Text variant="caption" color="textMuted" numberOfLines={2}>
        {phase.focus}
      </Text>
    </View>
  );
}

/**
 * Compact "next race" card (Progreso): countdown, race and season phase (opens
 * Carreras), plus "Ver plan general" for the weeks until the race.
 */
export function RaceCountdownCard({ race, phase, today }: RaceCountdownCardProps) {
  const { colors } = useTheme();
  if (!race) {
    return (
      <Card variant="flat" padding="sm">
        <ListRow
          icon="flag"
          iconTint={colors.accentSoft}
          iconColor={colors.onAccentSoft}
          title="Sin carrera a la vista"
          subtitle="Añade tu próxima carrera y el plan se organizará por fases hacia ella."
          onPress={openRaces}
        />
      </Card>
    );
  }
  const cd = countdown(race.date, today);
  return (
    <Card variant="flat" padding="lg" style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${cd.spoken} para ${race.name}. Ver carreras.`}
        onPress={() => {
          haptics.tap();
          openRaces();
        }}
        style={({ pressed }) => [styles.top, pressed && styles.pressed]}>
        <CountdownTile value={cd.value} unit={cd.unit} />
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <PriorityBadge priority={race.priority} size={20} />
            <Text variant="heading" style={styles.flex} numberOfLines={2}>
              {race.name}
            </Text>
          </View>
          <Text variant="caption" color="textMuted" numberOfLines={2}>
            {`${formatDayLong(race.date)} · ${raceDistanceLabel(race.distance)}`}
          </Text>
        </View>
        <Icon name="chevronRight" size={14} color={colors.textFaint} />
      </Pressable>
      {phase ? <PhaseBlock phase={phase} /> : null}
      <Button
        label="Ver plan general"
        icon="week"
        variant="secondary"
        size="sm"
        onPress={openSeason}
        accessibilityHint="Abre en Plan las semanas hasta la carrera"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Opacity only: no layout shift while pressed.
  pressed: { opacity: 0.7 },
  tile: { minWidth: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.sm },
  info: { flex: 1, gap: space.xxs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  phase: { gap: space.sm },
  flex: { flex: 1 },
});
