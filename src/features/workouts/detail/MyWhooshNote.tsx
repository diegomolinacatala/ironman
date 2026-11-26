import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { myWhooshA11y, myWhooshFor, myWhooshText } from '@/domain/mywhoosh';
import type { RaceDistance, Thresholds, Workout } from '@/domain/types';
import { Icon, Text, iconSize, space, useTheme } from '@/ui';

import { useMyWhooshEnabled } from '../myWhooshSetting';

export interface MyWhooshNoteProps {
  workout: Workout;
  thresholds: Thresholds | null;
  raceDistance: RaceDistance | null;
}

/**
 * One quiet line on a planned bike session, only when the athlete rides indoors with
 * MyWhoosh (Tú › Entrenamiento): «En rodillo: MyWhoosh › Threshold › Threshold 20 (…)».
 */
export function MyWhooshNote({ workout, thresholds, raceDistance }: MyWhooshNoteProps) {
  const { colors } = useTheme();
  const enabled = useMyWhooshEnabled();
  const pick = useMemo(
    () => (enabled && workout.status === 'planned' ? myWhooshFor(workout, { thresholds, raceDistance }) : null),
    [enabled, workout, thresholds, raceDistance],
  );
  if (!pick) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={myWhooshA11y(pick)}>
      <Icon name="bike" size={iconSize.sm} color={colors.textMuted} />
      <Text variant="callout" color="textMuted" style={styles.text}>
        {`En rodillo: ${myWhooshText(pick)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.xs },
  text: { flex: 1 },
});
