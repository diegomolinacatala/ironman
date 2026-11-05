/**
 * Horizontal avatar strip to pick the friend to compare with. The selected friend gets an
 * `accentInk` ring and a brand-tinted avatar; the optional last item opens "Añadir amigo".
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Friend, UUID } from '@/domain/types';
import { Avatar, Icon, Text, fonts, haptics, iconSize, space, useTheme } from '@/ui';

import { firstName } from './friendModel';

export interface FriendSelectorProps {
  friends: readonly Friend[];
  selectedId: UUID | null;
  onSelect: (profileId: UUID) => void;
  /** Shows a trailing "Añadir" item when given. */
  onAdd?: () => void;
}

const AVATAR = 48;
const RING = 2;
const GAP = 2;
const ITEM_WIDTH = AVATAR + (RING + GAP) * 2 + 8;

function AddItem({ onAdd }: { onAdd: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Añadir amigo"
      onPress={() => {
        haptics.tap();
        onAdd();
      }}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <View style={[styles.ring, { borderColor: 'transparent' }]}>
        <View style={[styles.add, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
          <Icon name="add" size={iconSize.md} color={colors.accentInk} />
        </View>
      </View>
      <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.name}>
        Añadir
      </Text>
    </Pressable>
  );
}

export function FriendSelector({ friends, selectedId, onSelect, onAdd }: FriendSelectorProps) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      accessibilityRole="tablist"
      accessibilityLabel="Amigos">
      {friends.map((friend) => {
        const selected = friend.profile.id === selectedId;
        return (
          <Pressable
            key={friend.friendshipId}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`Comparar con ${friend.profile.displayName}`}
            onPress={() => {
              haptics.tap();
              onSelect(friend.profile.id);
            }}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
            <View style={[styles.ring, { borderColor: selected ? colors.accentInk : 'transparent' }]}>
              <Avatar name={friend.profile.displayName} size={AVATAR} color={selected ? undefined : colors.surfaceAlt} />
            </View>
            <Text
              variant="caption"
              color={selected ? 'accentInk' : 'textMuted'}
              numberOfLines={1}
              style={[styles.name, selected && styles.selectedName]}>
              {firstName(friend.profile.displayName)}
            </Text>
          </Pressable>
        );
      })}
      {onAdd ? <AddItem onAdd={onAdd} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.sm, paddingRight: space.lg },
  item: { alignItems: 'center', gap: space.xs, width: ITEM_WIDTH, minHeight: 44 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  ring: { borderWidth: RING, borderRadius: (AVATAR + (RING + GAP) * 2) / 2, padding: GAP },
  add: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { maxWidth: ITEM_WIDTH, textAlign: 'center' },
  selectedName: { fontFamily: fonts.bodySemibold },
});
