import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { LifeEvent } from '@/domain/types';
import { Icon, Text, haptics, radius, space, useTheme, type IconName } from '@/ui';

function NoteChip({ icon, label, onPress, hint }: { icon: IconName; label: string; onPress?: () => void; hint?: string }) {
  const { colors } = useTheme();
  const body = (
    <>
      <Icon name={icon} size={14} color={colors.textMuted} />
      <Text variant="caption" style={styles.text}>
        {label}
      </Text>
      {onPress ? <Icon name="chevronRight" size={12} color={colors.textFaint} /> : null}
    </>
  );
  const base = [styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }];
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={base}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [...base, pressed && { backgroundColor: colors.surfacePressed }]}>
      {body}
    </Pressable>
  );
}

export interface NoteChipsProps {
  memory: readonly string[];
  lifeEvent: LifeEvent | null;
}

/** What the coach remembered and the imprevisto it logged from this message. */
export function NoteChips({ memory, lifeEvent }: NoteChipsProps) {
  if (memory.length === 0 && !lifeEvent) return null;
  return (
    <View style={styles.list}>
      {memory.map((item) => (
        <NoteChip key={item} icon="brain" label={`Lo recordaré: ${item}`} />
      ))}
      {lifeEvent ? (
        <NoteChip
          icon="flag"
          label={`Apuntado: ${lifeEvent.title}`}
          hint="Abre el imprevisto para revisarlo"
          onPress={() => router.push(`/event/edit?id=${encodeURIComponent(lifeEvent.id)}`)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 36,
    maxWidth: '100%',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flexShrink: 1 },
});
