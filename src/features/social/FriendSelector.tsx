/**
 * Horizontal avatar strip to pick the friend to compare with. Selected friend
 * gets a lime ring; the last item opens "Añadir amigo".
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Friend, UUID } from '@/domain/types';
import { Avatar, Icon, Text, haptics, space, useTheme } from '@/ui';

import { firstName } from './friendModel';

export interface FriendSelectorProps {
  friends: readonly Friend[];
  selectedId: UUID | null;
  onSelect: (profileId: UUID) => void;
  onAdd: () => void;
}

const AVATAR = 52;
const RING = 3;

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
            <View style={[styles.ring, { borderColor: selected ? colors.accent : 'transparent' }]}>
              <Avatar name={friend.profile.displayName} size={AVATAR} color={selected ? undefined : colors.textMuted} />
            </View>
            <Text variant="caption" color={selected ? 'text' : 'textMuted'} numberOfLines={1} style={styles.name}>
              {firstName(friend.profile.displayName)}
            </Text>
          </Pressable>
        );
      })}
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
            <Icon name="add" size={22} color={colors.text} />
          </View>
        </View>
        <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.name}>
          Añadir
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.md, paddingRight: space.lg },
  item: { alignItems: 'center', gap: space.xs, width: AVATAR + RING * 2 + 8 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  ring: { borderWidth: RING, borderRadius: (AVATAR + RING * 4) / 2, padding: 2 },
  add: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { maxWidth: AVATAR + 16, textAlign: 'center' },
});
