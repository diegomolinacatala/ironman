import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { diffDays } from '@/domain/dates';
import { phaseLabel, raceDistanceLabel } from '@/domain/labels';
import type { PhaseInfo } from '@/domain/periodization';
import type { ISODate, Race } from '@/domain/types';
import { Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import { raceChipPalette } from './raceChipPalette';

export function daysLabel(days: number): string {
  if (days === 0) return 'Es hoy';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

/** Race-bib style countdown to the next race + current training phase. */
/** "Media distancia · Triatlón de Valencia", without repeating the distance when the name already has it. */
export function chipTitle(name: string, distance: string): string {
  return name.toLowerCase().includes(distance.toLowerCase()) ? name : `${distance} · ${name}`;
}

export function RaceChip({ race, phase, today }: { race: Race | null; phase: PhaseInfo | null; today: ISODate }) {
  const theme = useTheme();
  const { colors } = theme;
  if (!race) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Añade tu próxima carrera"
        onPress={() => router.push('/races/edit')}
        style={({ pressed }) => [styles.chip, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}>
        <Icon name="flag" size={16} color={colors.textMuted} />
        <Text variant="caption" color="textMuted">
          Añade tu próxima carrera
        </Text>
      </Pressable>
    );
  }
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
      <Icon name="flag" size={16} color={ink.accent} />
      <View style={styles.texts}>
        <Text variant="overline" style={{ color: ink.text }} numberOfLines={1}>
          {chipTitle(race.name, raceDistanceLabel(race.distance))}
        </Text>
      </View>
      <Text variant="metricSmall" style={{ color: ink.accent }}>
        {daysLabel(days)}
      </Text>
      {phaseText ? (
        <View style={[styles.phase, { borderColor: ink.text }]}>
          <Text variant="overline" style={{ color: ink.text, fontSize: 10 }}>
            {phaseText}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'stretch',
  },
  texts: { flex: 1 },
  phase: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
});
