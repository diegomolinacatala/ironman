import { Pressable, StyleSheet, View } from 'react-native';

import { raceDistanceLabel } from '@/domain/labels';
import type { Phase, PhaseInfo } from '@/domain/periodization';
import type { WeekPlan } from '@/domain/types';
import { Icon, Tag, Text, haptics, iconSize, radius, space, useTheme, type IconName } from '@/ui';

/** Phase names as the plan talks ("Afinamiento", not "Puesta a punto"). */
const PHASE_NAME: Readonly<Record<Phase, string>> = {
  prep: 'Preparación',
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Afinamiento',
  race_week: 'Semana de carrera',
  recovery: 'Recuperación',
  transition: 'Transición',
};

function phaseName(info: PhaseInfo): string {
  return info.subphase === 'maintenance' && !info.targetRace ? 'Mantenimiento' : PHASE_NAME[info.phase];
}

/** "Construcción · 18 semanas para Media distancia" / "Mantenimiento". */
export function phaseHeadline(info: PhaseInfo): string {
  const phase = phaseName(info);
  if (!info.targetRace || info.weeksToRace == null) return phase;
  const distance = raceDistanceLabel(info.targetRace.distance);
  if (info.weeksToRace <= 0) return `${phase} · ${distance} esta semana`;
  const weeks = info.weeksToRace === 1 ? '1 semana' : `${info.weeksToRace} semanas`;
  return `${phase} · ${weeks} para ${distance}`;
}

interface KindTag {
  label: string;
  icon: IconName;
}

/** What kind of week it is when it is not a normal load week: Descarga, Semana libre, Más volumen. */
export function weekKindTag(info: PhaseInfo, plan: WeekPlan | null): KindTag | null {
  if (plan?.kind === 'rest') return { label: 'Semana libre', icon: 'rest' };
  if (plan?.kind === 'push') return { label: 'Más volumen', icon: 'arrowUp' };
  // Post-race recovery / transition already say so in the headline.
  if (info.isRecoveryWeek && info.phase !== 'recovery' && info.phase !== 'transition') return { label: 'Descarga', icon: 'moon' };
  return null;
}

export interface PhaseLineProps {
  info: PhaseInfo | null;
  /** The week's override (Plan → General), when one applies. */
  plan?: WeekPlan | null;
  /** Opens Plan → General. */
  onPress?: () => void;
}

/** Phase of the week + "Descarga" / "Ajustada" tags + focus. Pressable → the general view. */
export function PhaseLine({ info, plan = null, onPress }: PhaseLineProps) {
  const { colors } = useTheme();
  if (!info) return null;
  const tag = weekKindTag(info, plan);
  const label = [phaseHeadline(info), tag?.label, plan ? 'Ajustada' : null, info.focus].filter(Boolean).join('. ');
  const content = (
    <>
      <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
        <Icon name="flag" size={iconSize.sm} color={colors.onAccentSoft} />
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {phaseHeadline(info)}
        </Text>
        {tag || plan ? (
          <View style={styles.tags}>
            {tag ? <Tag label={tag.label} color={colors.info} tone="soft" icon={tag.icon} /> : null}
            {plan ? <Tag label="Ajustada" color={colors.accentInk} tone="soft" icon="edit" /> : null}
          </View>
        ) : null}
        {info.focus ? (
          <Text variant="caption" color="textMuted">
            {info.focus}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon name="chevronRight" size={14} color={colors.textFaint} style={styles.chevron} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.root} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Abre el plan general"
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.root, styles.pressable, pressed && { backgroundColor: colors.surfacePressed }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  pressable: { borderRadius: radius.md, padding: space.xs, margin: -space.xs },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2, paddingTop: 5 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginVertical: 2 },
  chevron: { marginTop: 9 },
});
