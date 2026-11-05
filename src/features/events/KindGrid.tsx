import { Pressable, StyleSheet, View } from 'react-native';

import { lifeEventLabel } from '@/domain/labels';
import { LIFE_EVENT_KINDS, type LifeEventKind } from '@/domain/types';
import { Icon, Text, fonts, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { lifeEventIcon } from './kinds';

/**
 * 3-column grid of imprevisto kinds with icons. Selected tile = `accentSoft` surface with an
 * `accent` border and `onAccentSoft` content (large-area selection never uses a saturated fill).
 */
export function KindGrid({ value, onChange }: { value: LifeEventKind; onChange: (k: LifeEventKind) => void }) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Tipo de imprevisto">
      {LIFE_EVENT_KINDS.map((kind) => (
        <KindTile key={kind} kind={kind} selected={kind === value} onPress={() => onChange(kind)} />
      ))}
    </View>
  );
}

function KindTile({ kind, selected, onPress }: { kind: LifeEventKind; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const fg = selected ? colors.onAccentSoft : colors.text;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={lifeEventLabel(kind)}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
      ]}>
      <Icon name={lifeEventIcon(kind)} size={iconSize.lg} color={selected ? colors.onAccentSoft : colors.textMuted} />
      <Text variant="caption" style={[{ color: fg }, selected && styles.selectedLabel]} numberOfLines={2} align="center">
        {lifeEventLabel(kind)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  selectedLabel: { fontFamily: fonts.bodySemibold },
});
