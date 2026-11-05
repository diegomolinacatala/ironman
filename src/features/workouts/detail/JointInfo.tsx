import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { JointStatus, ParticipantStatus, UUID } from '@/domain/types';
import { useJointSession } from '@/data/queries';
import { errorMessage } from '@/lib/logger';
import { Avatar, Card, ErrorNotice, Icon, Loading, Text, iconSize, space, useTheme } from '@/ui';

const SESSION_STATUS: Record<JointStatus, string> = {
  proposed: 'Pendiente de respuesta',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
};

const PARTICIPANT_STATUS: Record<ParticipantStatus, string> = {
  invited: 'Invitado',
  accepted: 'Se apunta',
  declined: 'No puede',
};

/** Quedada card on the workout detail: partners + status → /joint/<id>. */
export function JointInfo({ sessionId, myId }: { sessionId: UUID; myId: UUID | undefined }) {
  const { colors } = useTheme();
  const session = useJointSession(sessionId);
  if (session.isLoading) return <Loading label="Cargando quedada" />;
  if (session.error) return <ErrorNotice message={errorMessage(session.error)} onRetry={() => void session.refetch()} />;
  if (!session.data) return null;
  const s = session.data;
  const others = s.participants.filter((p) => p.userId !== myId);
  return (
    <Card
      variant="tinted"
      tint={colors.accentSoft}
      padding="md"
      onPress={() => router.push(`/joint/${s.id}`)}
      accessibilityLabel={`Quedada: ${SESSION_STATUS[s.status]}. ${others.map((p) => p.displayName).join(', ')}`}>
      <View style={styles.head}>
        <Icon name="together" size={iconSize.md} color={colors.onAccentSoft} />
        <View style={styles.flex}>
          <Text variant="caption" color="onAccentSoft">
            Quedada
          </Text>
          <Text variant="heading">{SESSION_STATUS[s.status]}</Text>
        </View>
        <Icon name="chevronRight" size={14} color={colors.onAccentSoft} />
      </View>
      <View style={styles.people}>
        {others.map((p) => (
          <View key={p.userId} style={styles.person}>
            <Avatar name={p.displayName} size={32} color={colors.accent} />
            <View>
              <Text variant="callout">{p.displayName}</Text>
              <Text variant="caption" color="textMuted">
                {PARTICIPANT_STATUS[p.status]}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {s.location ? (
        <View style={styles.head}>
          <Icon name="location" size={14} color={colors.textMuted} />
          <Text variant="caption" color="textMuted">
            {s.location}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.md, marginBottom: space.xs },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
