import { StyleSheet, View } from 'react-native';

import { phaseLabel, raceDistanceLabel } from '@/domain/labels';
import type { PhaseInfo } from '@/domain/periodization';
import { Icon, Tag, Text, iconSize, radius, space, useTheme } from '@/ui';

export function phaseHeadline(info: PhaseInfo): string {
  const phase = phaseLabel(info.phase);
  if (!info.targetRace || info.weeksToRace == null) return phase;
  const distance = raceDistanceLabel(info.targetRace.distance);
  if (info.weeksToRace <= 0) return `${phase} · ${distance} esta semana`;
  const weeks = info.weeksToRace === 1 ? '1 semana' : `${info.weeksToRace} semanas`;
  return `${phase} · ${weeks} para ${distance}`;
}

/** "Construcción · 18 semanas para Media distancia" + recovery-week badge + focus. */
export function PhaseLine({ info }: { info: PhaseInfo | null }) {
  const { colors } = useTheme();
  if (!info) return null;
  return (
    <View
      style={styles.root}
      accessible
      accessibilityLabel={`${phaseHeadline(info)}${info.isRecoveryWeek ? '. Semana de recuperación' : ''}. ${info.focus}`}>
      <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
        <Icon name="flag" size={iconSize.sm} color={colors.onAccentSoft} />
      </View>
      <View style={styles.text}>
        <View style={styles.row}>
          <Text variant="bodyStrong" style={styles.flex} numberOfLines={2}>
            {phaseHeadline(info)}
          </Text>
          {info.isRecoveryWeek ? <Tag label="Recuperación" color={colors.info} tone="soft" icon="moon" /> : null}
        </View>
        {info.focus ? (
          <Text variant="caption" color="textMuted">
            {info.focus}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2, paddingTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
