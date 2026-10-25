import { Pressable, StyleSheet, View } from 'react-native';

import { lifeEventLabel } from '@/domain/labels';
import { LIFE_EVENT_KINDS, type LifeEventKind } from '@/domain/types';
import { Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import { lifeEventIcon } from './kinds';

/** 3-column grid of imprevisto kinds with icons. */
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
  const fg = selected ? colors.inverseText : colors.text;
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
          backgroundColor: selected ? colors.inverseBg : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.inverseBg : colors.border,
        },
      ]}>
      <Icon name={lifeEventIcon(kind)} size={22} color={fg} />
      <Text variant="caption" style={{ color: fg }} numberOfLines={2} align="center">
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
    borderWidth: 1,
  },
});
