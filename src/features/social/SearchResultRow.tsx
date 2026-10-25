/**
 * Search result with the right action for the relation: Añadir / Pendiente /
 * Aceptar / Amigos.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { PublicProfile } from '@/domain/types';
import { useRespondFriendRequest, useSendFriendRequest } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Avatar, Button, Tag, Text, haptics, space, useTheme } from '@/ui';

import type { FriendRelation } from './friendModel';

export interface SearchResultRowProps {
  profile: PublicProfile;
  relation: FriendRelation;
}

function RelationAction({ profile, relation }: SearchResultRowProps) {
  const { colors } = useTheme();
  const send = useSendFriendRequest();
  const respond = useRespondFriendRequest();
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      haptics.success();
    } catch (e) {
      logger.warn('friend search action failed', e);
      setError(errorMessage(e, 'No se ha podido enviar la solicitud.'));
    }
  };

  if (relation.kind === 'self') return <Tag label="Tú" color={colors.textMuted} tone="outline" />;
  if (relation.kind === 'friends') return <Tag label="Amigos" color={colors.accentInk} icon="checkCircle" />;
  if (relation.kind === 'outgoing') return <Tag label="Pendiente" color={colors.info} icon="clock" />;
  const isIncoming = relation.kind === 'incoming';
  const pending = isIncoming ? respond.isPending : send.isPending;
  return (
    <View style={styles.actionCol}>
      <Button
        label={isIncoming ? 'Aceptar' : 'Añadir'}
        icon={isIncoming ? 'check' : 'add'}
        variant={isIncoming ? 'primary' : 'secondary'}
        loading={pending}
        onPress={() =>
          void run(() =>
            relation.kind === 'incoming'
              ? respond.mutateAsync({ friendshipId: relation.friendshipId, accept: true })
              : send.mutateAsync(profile.username),
          )
        }
        accessibilityHint={isIncoming ? `Acepta la solicitud de ${profile.displayName}` : `Envía una solicitud a ${profile.displayName}`}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function SearchResultRow({ profile, relation }: SearchResultRowProps) {
  return (
    <View style={styles.row}>
      <Avatar name={profile.displayName || profile.username} size={44} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {profile.displayName}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          @{profile.username}
        </Text>
      </View>
      <RelationAction profile={profile} relation={relation} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  text: { flex: 1, gap: 2 },
  actionCol: { alignItems: 'flex-end', gap: space.xs, maxWidth: 180 },
  error: { textAlign: 'right' },
});
