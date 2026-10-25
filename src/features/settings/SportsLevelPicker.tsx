import { Pressable, StyleSheet, View } from 'react-native';

import { levelLabel, sportLabel } from '@/domain/labels';
import { TRAINABLE_SPORTS, type AthleteLevel, type TrainableSport } from '@/domain/types';
import { Icon, Segmented, Text, haptics, radius, space, useTheme } from '@/ui';

import { toggleSport } from '../onboarding/onboardingModel';

const LEVELS: readonly AthleteLevel[] = ['beginner', 'intermediate', 'advanced'];

const LEVEL_HELP: Record<AthleteLevel, string> = {
  beginner: 'Menos de 2 años entrenando o tu primera temporada de triatlón.',
  intermediate: 'Ya has terminado varias carreras y entrenas con constancia.',
  advanced: 'Varias temporadas, distancias largas y volumen alto.',
};

export interface SportsLevelPickerProps {
  sports: readonly TrainableSport[];
  level: AthleteLevel;
  onChangeSports: (sports: TrainableSport[]) => void;
  onChangeLevel: (level: AthleteLevel) => void;
}

/** Sport tiles (multi-select, colour-coded) + athlete level. */
export function SportsLevelPicker({ sports, level, onChangeSports, onChangeLevel }: SportsLevelPickerProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Deportes
        </Text>
        <View style={styles.grid}>
          {TRAINABLE_SPORTS.map((sport) => (
            <SportTile
              key={sport}
              sport={sport}
              selected={sports.includes(sport)}
              onPress={() => onChangeSports(toggleSport(sports, sport))}
            />
          ))}
        </View>
        {sports.length === 0 ? (
          <Text variant="caption" color="danger">
            Elige al menos un deporte.
          </Text>
        ) : null}
      </View>
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Nivel
        </Text>
        <Segmented
          accessibilityLabel="Nivel"
          options={LEVELS.map((l) => ({ value: l, label: levelLabel(l) }))}
          value={level}
          onChange={onChangeLevel}
        />
        <Text variant="caption" color="textMuted">
          {LEVEL_HELP[level]}
        </Text>
      </View>
    </View>
  );
}

function SportTile({ sport, selected, onPress }: { sport: TrainableSport; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.sport(sport);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={sportLabel(sport)}
      accessibilityState={{ checked: selected }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: selected ? c.base : pressed ? theme.colors.surfacePressed : theme.colors.surface,
          borderColor: selected ? c.base : theme.colors.border,
        },
      ]}>
      <Icon name={sport} size={26} color={selected ? '#FFFFFF' : c.base} />
      <Text variant="bodyStrong" style={{ color: selected ? '#FFFFFF' : theme.colors.text }}>
        {sportLabel(sport)}
      </Text>
      <View style={[styles.check, { borderColor: selected ? '#FFFFFF' : theme.colors.borderStrong }]}>
        {selected ? <Icon name="check" size={12} color="#FFFFFF" weight="bold" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  block: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 92,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.md,
    justifyContent: 'space-between',
    gap: space.sm,
  },
  check: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
