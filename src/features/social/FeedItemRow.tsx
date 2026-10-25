/**
 * Feed entry: "Álex completó Rodaje Z2 · 1h 10'" with sport badge, relative
 * time and a kudos toggle (optimistic while the request is in flight).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import type { FeedItem, ISODate, UUID } from '@/domain/types';
import { useToggleKudos } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Avatar, Icon, SportBadge, Text, haptics, radius, space, useTheme } from '@/ui';

import { showNotice } from './confirm';
import { describeFeedItem } from './feedText';
import { relativeTime } from './relativeTime';

export interface FeedItemRowProps {
  item: FeedItem;
  myId: UUID | null;
  today: ISODate;
}

function KudosButton({ item, isMine }: { item: FeedItem; isMine: boolean }) {
  const { colors } = useTheme();
  const toggle = useToggleKudos();
  const optimistic = toggle.isPending;
  const hasKudoed = optimistic ? !item.hasKudoed : item.hasKudoed;
  const count = Math.max(0, item.kudosCount + (optimistic ? (item.hasKudoed ? -1 : 1) : 0));
  const color = hasKudoed ? colors.accentInk : colors.textMuted;
  const label = isMine
    ? `${count} ${count === 1 ? 'aplauso' : 'aplausos'}`
    : `${hasKudoed ? 'Quitar aplauso' : 'Dar aplauso'}. ${count} en total`;

  const onPress = async () => {
    haptics.tap();
    try {
      await toggle.mutateAsync(item.id);
    } catch (e) {
      logger.warn('toggle kudos failed', e);
      showNotice('No se ha podido guardar', errorMessage(e));
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: hasKudoed, disabled: isMine || optimistic }}
      disabled={isMine || optimistic}
      hitSlop={8}
      onPress={() => void onPress()}
      style={({ pressed }) => [styles.kudos, pressed && { backgroundColor: colors.surfacePressed }]}>
      <Icon name={hasKudoed ? 'heart' : 'heartOutline'} size={18} color={color} />
      <Text variant="caption" style={{ color }}>
        {count}
      </Text>
    </Pressable>
  );
}

export function FeedItemRow({ item, myId, today }: FeedItemRowProps) {
  const text = describeFeedItem(item, myId, today);
  const isMine = myId !== null && item.actor.id === myId;
  const when = relativeTime(item.createdAt);
  return (
    <View style={styles.row}>
      <Avatar name={item.actor.displayName || item.actor.username} size={40} />
      <View style={styles.body} accessible accessibilityLabel={`${text.actor} ${text.action}. ${text.detail ?? ''} ${when}`}>
        <Text variant="callout">
          <Text variant="bodyStrong">{text.actor}</Text> {text.action}
        </Text>
        {text.detail ? (
          <Text variant="caption" color="textMuted">
            {text.detail}
          </Text>
        ) : null}
        <Text variant="caption" color="textFaint">
          {when}
        </Text>
      </View>
      <View style={styles.side}>
        {text.sport ? <SportBadge sport={text.sport} size={32} /> : null}
        <KudosButton item={item} isMine={isMine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
  side: { alignItems: 'center', gap: space.xs },
  kudos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
});
