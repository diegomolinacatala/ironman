import { StyleSheet, View } from 'react-native';

import { phaseLabel, raceDistanceLabel } from '@/domain/labels';
import type { PhaseInfo } from '@/domain/periodization';
import { Icon, Tag, Text, space, useTheme } from '@/ui';

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
    <View style={styles.root} accessible accessibilityLabel={`${phaseHeadline(info)}${info.isRecoveryWeek ? '. Semana de recuperación' : ''}. ${info.focus}`}>
      <View style={styles.row}>
        <Icon name="flag" size={14} color={colors.textMuted} />
        <Text variant="callout" style={styles.flex} numberOfLines={2}>
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
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
