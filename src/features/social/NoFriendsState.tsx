import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, radius, space, useTheme } from '@/ui';

import { useInviteActions } from './useInviteActions';

export interface NoFriendsStateProps {
  username: string | null;
  pendingOutgoing: number;
  onAdd: () => void;
}

const POINTS = [
  { icon: 'calendarBadge', text: 'Huecos: los ratos en que los dos estáis libres, sin comparar calendarios a mano.' },
  { icon: 'sparkles', text: 'Oportunidades: si los dos tenéis rodaje el sábado, os lo proponemos juntos.' },
  { icon: 'lock', text: 'Tú decides qué ven: todo, solo deporte y duración, o solo ocupado/libre.' },
] as const;

/** Empty Juntos: what "ir a rebufo" means + share my username. */
export function NoFriendsState({ username, pendingOutgoing, onAdd }: NoFriendsStateProps) {
  const { colors } = useTheme();
  const invite = useInviteActions(username);
  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text variant="overline" color="accentInk">
        Ir a rebufo
      </Text>
      <Text variant="title">Entrenar acompañado es más fácil</Text>
      <View style={styles.points}>
        {POINTS.map((point) => (
          <View key={point.icon} style={styles.point}>
            <Icon name={point.icon} size={18} color={colors.accentInk} />
            <Text variant="callout" style={styles.flex}>
              {point.text}
            </Text>
          </View>
        ))}
      </View>
      {pendingOutgoing > 0 ? (
        <Text variant="caption" color="textMuted">
          {pendingOutgoing === 1 ? 'Tienes 1 solicitud enviada pendiente.' : `Tienes ${pendingOutgoing} solicitudes enviadas pendientes.`}
        </Text>
      ) : null}
      <Button label="Buscar amigos" icon="search" onPress={onAdd} fullWidth />
      {username ? (
        <Button
          label={invite.copied ? 'Invitación copiada' : `Compartir mi usuario @${username}`}
          icon="share"
          variant="secondary"
          onPress={() => void invite.share()}
          loading={invite.sharing}
          fullWidth
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.lg, padding: space.xl, gap: space.md },
  points: { gap: space.md, marginVertical: space.xs },
  point: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
