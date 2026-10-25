import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useNotifications } from '@/data/queries';
import { IconButton, Text, useTheme } from '@/ui';

import { unreadCount } from './notificationModel';

/** Bell with unread badge → /notifications. */
export function NotificationsBell() {
  const { colors } = useTheme();
  const notifications = useNotifications();
  const unread = unreadCount(notifications.data);
  return (
    <View>
      <IconButton
        icon="bell"
        variant="filled"
        size={44}
        accessibilityLabel={unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos'}
        onPress={() => router.push('/notifications')}
      />
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
          <Text variant="caption" style={[styles.badgeText, { color: colors.onAccent }]}>
            {unread > 9 ? '9+' : unread}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    pointerEvents: 'none',
  },
  badgeText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
});
