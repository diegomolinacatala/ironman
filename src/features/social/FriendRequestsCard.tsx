import { StyleSheet, View } from 'react-native';

import type { Friend } from '@/domain/types';
import { Card, Divider, Icon, Text, space, useTheme } from '@/ui';

import { FriendRequestRow } from './FriendRequestRow';

/** Incoming friend requests (Juntos tab). Renders nothing when empty. */
export function FriendRequestsCard({ requests }: { requests: readonly Friend[] }) {
  const { colors } = useTheme();
  if (requests.length === 0) return null;
  return (
    <Card padding="lg" variant="raised">
      <View style={styles.header}>
        <Icon name="together" size={16} color={colors.accentInk} />
        <Text variant="overline" color="accentInk" accessibilityRole="header">
          {requests.length === 1 ? 'Solicitud de amistad' : `${requests.length} solicitudes de amistad`}
        </Text>
      </View>
      {requests.map((friend, index) => (
        <View key={friend.friendshipId}>
          {index > 0 ? <Divider /> : null}
          <FriendRequestRow friend={friend} />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
});
