/**
 * One pending friend request with its actions: incoming → Aceptar / Rechazar,
 * outgoing → Cancelar. Each row owns its mutation so loading states are local.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Friend } from '@/domain/types';
import { useRemoveFriend, useRespondFriendRequest } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Avatar, Button, Text, haptics, space } from '@/ui';

type Busy = 'accept' | 'decline' | 'cancel' | null;

export function FriendRequestRow({ friend }: { friend: Friend }) {
  const respond = useRespondFriendRequest();
  const remove = useRemoveFriend();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const incoming = friend.direction === 'incoming';

  const run = async (kind: Exclude<Busy, null>) => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'cancel') await remove.mutateAsync(friend.friendshipId);
      else await respond.mutateAsync({ friendshipId: friend.friendshipId, accept: kind === 'accept' });
      if (kind === 'accept') haptics.success();
    } catch (e) {
      logger.warn('friend request action failed', e);
      setError(errorMessage(e, 'No se ha podido completar la acción.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Avatar name={friend.profile.displayName} size={40} />
        <View style={styles.text}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {friend.profile.displayName}
          </Text>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            @{friend.profile.username} · {incoming ? 'quiere entrenar contigo' : 'solicitud enviada'}
          </Text>
        </View>
        {incoming ? null : (
          <Button label="Cancelar" variant="ghost" onPress={() => void run('cancel')} loading={busy === 'cancel'} />
        )}
      </View>
      {incoming ? (
        <View style={styles.actions}>
          <Button
            label="Aceptar"
            icon="check"
            onPress={() => void run('accept')}
            loading={busy === 'accept'}
            disabled={busy !== null}
            style={styles.flex}
          />
          <Button
            label="Rechazar"
            variant="secondary"
            onPress={() => void run('decline')}
            loading={busy === 'decline'}
            disabled={busy !== null}
            style={styles.flex}
          />
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: space.sm, paddingLeft: 40 + space.md },
  flex: { flex: 1 },
});
