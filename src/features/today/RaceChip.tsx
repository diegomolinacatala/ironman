import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { diffDays } from '@/domain/dates';
import { phaseLabel, raceDistanceLabel } from '@/domain/labels';
import type { PhaseInfo } from '@/domain/periodization';
import type { ISODate, Race } from '@/domain/types';
import { Icon, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { raceChipPalette } from './raceChipPalette';

const TILE_SIZE = 32;

export function daysLabel(days: number): string {
  if (days === 0) return 'Es hoy';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

/** "Media distancia · Triatlón de Valencia", without repeating the distance when the name already has it. */
export function chipTitle(name: string, distance: string): string {
  return name.toLowerCase().includes(distance.toLowerCase()) ? name : `${distance} · ${name}`;
}

function AddRaceChip() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Añade tu próxima carrera"
      onPress={() => router.push('/races/edit')}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface },
      ]}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name="flag" size={iconSize.sm} color={colors.textMuted} />
      </View>
      <Text variant="callout" color="textMuted" style={styles.texts}>
        Añade tu próxima carrera
      </Text>
      <Icon name="chevronRight" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

/** Countdown to the next race + current training phase, as a calm brand-tinted row. */
export function RaceChip({ race, phase, today }: { race: Race | null; phase: PhaseInfo | null; today: ISODate }) {
  const theme = useTheme();
  if (!race) return <AddRaceChip />;
  const ink = raceChipPalette(theme);
  const days = Math.max(0, diffDays(race.date, today));
  const phaseText = phase ? phaseLabel(phase.phase) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${race.name}, ${raceDistanceLabel(race.distance)}, ${daysLabel(days)}${phaseText ? `. Fase: ${phaseText}` : ''}`}
      onPress={() => {
        haptics.tap();
        router.push('/races');
      }}
      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? ink.pressed : ink.background, borderColor: ink.border }]}>
      <View style={[styles.tile, { backgroundColor: ink.tile }]}>
        <Icon name="flag" size={iconSize.sm} color={ink.accent} />
      </View>
      <View style={styles.texts}>
        <Text variant="callout" style={{ color: ink.text }} numberOfLines={1}>
          {chipTitle(race.name, raceDistanceLabel(race.distance))}
        </Text>
        {phaseText ? (
          <Text variant="caption" style={{ color: ink.text }} numberOfLines={1}>
            {`Fase: ${phaseText}`}
          </Text>
        ) : null}
      </View>
      <Text variant="metricSmall" style={{ color: ink.accent }}>
        {daysLabel(days)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignSelf: 'stretch',
  },
  tile: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
});
