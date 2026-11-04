/** Weekly volume side by side ("Tú 6 h 30 · David 5 h 10"), done vs planned. */
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { Card, ProgressBar, Text, space, useTheme } from '@/ui';

import type { Volume, WeekVolumes } from './sharedModel';

function Lane({ name, volume, color }: { name: string; volume: Volume; color: string }) {
  const ratio = volume.totalMin > 0 ? volume.doneMin / volume.totalMin : 0;
  const label = `${name}: ${formatDuration(volume.doneMin)} hechas de ${formatDuration(volume.totalMin)}`;
  return (
    <View style={styles.lane}>
      <View style={styles.head}>
        <Text variant="bodyStrong">{name}</Text>
        <Text variant="caption" color="textMuted">
          {formatDuration(volume.doneMin)} / {formatDuration(volume.totalMin)} · {volume.sessions} {volume.sessions === 1 ? 'sesión' : 'sesiones'}
        </Text>
      </View>
      <ProgressBar value={Math.min(1, ratio)} color={color} accessibilityLabel={label} />
    </View>
  );
}

export function WeekVolumeCompare({ volumes, myName, friendName }: { volumes: WeekVolumes; myName: string; friendName: string }) {
  const { colors } = useTheme();
  if (!volumes.theirs || (volumes.mine.totalMin === 0 && volumes.theirs.totalMin === 0)) return null;
  return (
    <Card padding="md">
      <View style={styles.box}>
        <Text variant="overline" color="textMuted">
          Volumen de la semana
        </Text>
        <Lane name={myName} volume={volumes.mine} color={colors.accent} />
        <Lane name={friendName} volume={volumes.theirs} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.md },
  lane: { gap: space.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
});
