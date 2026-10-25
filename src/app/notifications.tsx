/**
 * Avisos: inbox grouped by Hoy / Esta semana / Antes. Tap marks as read and
 * opens the deep link (internal paths only).
 */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useMarkNotificationsRead, useNotifications } from '@/data/queries';
import type { AppNotification } from '@/domain/types';
import { showNotice } from '@/features/social/confirm';
import { groupNotifications, isTabPath, notificationHref, unreadCount } from '@/features/social/notificationModel';
import { NotificationRow } from '@/features/social/NotificationRow';
import { errorMessage, logger } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

export default function NotificationsScreen() {
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const items = notifications.data ?? [];
  const groups = groupNotifications(items);
  const unread = unreadCount(items);

  const open = (notification: AppNotification) => {
    if (notification.readAt === null) {
      markRead.mutate([notification.id], {
        onError: (error) => logger.warn('mark notification read failed', error),
      });
    }
    const href = notificationHref(notification);
    if (!href) return;
    // Avisos sits on top of the tabs: go back to them instead of pushing a second tab bar.
    if (isTabPath(href)) router.dismissTo(href);
    else router.push(href);
  };

  const markAll = async () => {
    try {
      await markRead.mutateAsync('all');
    } catch (error) {
      logger.warn('mark all notifications read failed', error);
      showNotice('No se han podido marcar', errorMessage(error));
    }
  };

  return (
    <Screen inSheet onRefresh={() => void notifications.refetch()} refreshing={notifications.isRefetching}>
      {notifications.isLoading ? <Loading label="Cargando avisos" /> : null}
      {notifications.error ? (
        <ErrorNotice
          message={errorMessage(notifications.error, 'No se han podido cargar los avisos.')}
          onRetry={() => void notifications.refetch()}
        />
      ) : null}
      {!notifications.isLoading && !notifications.error && items.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Todo tranquilo"
          message="Aquí te avisaremos de invitaciones a quedadas, solicitudes de amistad, aplausos y cambios en tu plan."
        />
      ) : null}
      {unread > 0 ? (
        <Button
          label={`Marcar todo como leído (${unread})`}
          icon="check"
          variant="secondary"
          onPress={() => void markAll()}
          loading={markRead.isPending && markRead.variables === 'all'}
          style={styles.markAll}
        />
      ) : null}
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <SectionHeader title={group.title} />
          {group.items.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} onPress={() => open(notification)} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xxs },
  markAll: { alignSelf: 'flex-start' },
});
