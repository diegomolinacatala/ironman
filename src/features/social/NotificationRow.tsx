import { Pressable, StyleSheet, View } from 'react-native';

import type { AppNotification } from '@/domain/types';
import { Icon, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { notificationIcon } from './notificationModel';
import { relativeTime } from './relativeTime';

const ICON_TILE = 32;

export interface NotificationRowProps {
  notification: AppNotification;
  onPress: () => void;
}

/** Inbox row: type icon tile (brand-tinted when unread), title/body, relative time and an unread dot. */
export function NotificationRow({ notification, onPress }: NotificationRowProps) {
  const { colors } = useTheme();
  const unread = notification.readAt === null;
  const when = relativeTime(notification.createdAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'No leído. ' : ''}${notification.title}. ${notification.body} ${when}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfacePressed : unread ? colors.surface : 'transparent' },
      ]}>
      <View style={[styles.icon, { backgroundColor: unread ? colors.accentSoft : colors.surfaceAlt }]}>
        <Icon name={notificationIcon(notification.type)} size={iconSize.sm} color={unread ? colors.onAccentSoft : colors.textMuted} />
      </View>
      <View style={styles.text}>
        <Text variant={unread ? 'bodyStrong' : 'body'} numberOfLines={2}>
          {notification.title}
        </Text>
        {notification.body ? (
          <Text variant="callout" color="textMuted" numberOfLines={3}>
            {notification.body}
          </Text>
        ) : null}
        <Text variant="caption" color="textMuted">
          {when}
        </Text>
      </View>
      {unread ? <View style={[styles.dot, { backgroundColor: colors.accentInk }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    minHeight: 56,
  },
  icon: { width: ICON_TILE, height: ICON_TILE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
});
