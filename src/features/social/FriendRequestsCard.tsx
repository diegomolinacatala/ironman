import { StyleSheet, View } from 'react-native';

import type { Friend } from '@/domain/types';
import { Card, Divider, SectionHeader, space } from '@/ui';

import { FriendRequestRow } from './FriendRequestRow';

/** Incoming friend requests (top of Juntos: the most actionable block). Renders nothing when empty. */
export function FriendRequestsCard({ requests }: { requests: readonly Friend[] }) {
  if (requests.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title={requests.length === 1 ? 'Solicitud de amistad' : `${requests.length} solicitudes de amistad`}
      />
      <Card padding="md">
        {requests.map((friend, index) => (
          <View key={friend.friendshipId}>
            {index > 0 ? <Divider /> : null}
            <FriendRequestRow friend={friend} />
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
