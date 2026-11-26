import { StyleSheet } from 'react-native';

import { Button, Card, Text, space, useTheme } from '@/ui';

import { useInviteActions } from './useInviteActions';

export interface NoFriendsStateProps {
  username: string | null;
  pendingOutgoing: number;
  onAdd: () => void;
}

/** Empty Juntos: what training together gives you + share my username. */
export function NoFriendsState({ username, pendingOutgoing, onAdd }: NoFriendsStateProps) {
  const { colors } = useTheme();
  const invite = useInviteActions(username);
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="xl" style={styles.box}>
      <Text variant="title" color="onAccentSoft">{pendingOutgoing > 0 ? 'Esperando respuesta' : '¿Con quién entrenas?'}</Text>
      <Text variant="callout" color="onAccentSoft">
        {pendingOutgoing > 0
          ? `Tienes ${pendingOutgoing === 1 ? 'una solicitud pendiente' : `${pendingOutgoing} solicitudes pendientes`}. Cuando acepten, podréis comparar horarios.`
          : 'Busca a un amigo para encontrar un hueco libre en vuestras agendas.'}
      </Text>
      <Button label={pendingOutgoing > 0 ? 'Ver solicitudes' : 'Buscar amigos'} icon={pendingOutgoing > 0 ? 'mail' : 'search'} onPress={onAdd} fullWidth />
      {username ? (
        <Button
          label={invite.copied ? 'Invitación copiada' : 'Compartir mi usuario'}
          icon="share"
          variant="ghost"
          onPress={() => void invite.share()}
          loading={invite.sharing}
          fullWidth
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.md },
});
