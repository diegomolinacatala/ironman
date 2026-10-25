import { Pressable, StyleSheet, View } from 'react-native';

import type { AppNotification } from '@/domain/types';
import { Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import { notificationIcon } from './notificationModel';
import { relativeTime } from './relativeTime';

export interface NotificationRowProps {
  notification: AppNotification;
  onPress: () => void;
}

/** Inbox row: type icon, title/body, relative time and an unread dot. */
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
      <View style={[styles.icon, { backgroundColor: unread ? colors.inverseBg : colors.surfaceAlt }]}>
        <Icon name={notificationIcon(notification.type)} size={18} color={unread ? colors.inverseText : colors.textMuted} />
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
        <Text variant="caption" color="textFaint">
          {when}
        </Text>
      </View>
      {unread ? <View style={[styles.dot, { backgroundColor: colors.accent, borderColor: colors.accentInk }]} /> : null}
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
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, borderWidth: 1 },
});
