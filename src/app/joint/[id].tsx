/**
 * Quedada detail: what, when, where, who — and my actions
 * (Aceptar/Rechazar when invited, Cancelar when I organise).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useJointSession } from '@/data/queries';
import { formatDayLong, formatDuration, todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { JointSession, UUID } from '@/domain/types';
import { IntensityTag } from '@/features/workouts/IntensityTag';
import { isOrganizer, myParticipant, sessionStatusCopy, sessionTimeLabel } from '@/features/together/jointModel';
import { openWorkout } from '@/features/together/navigation';
import { ParticipantRow } from '@/features/together/ParticipantRow';
import { StatusTag } from '@/features/together/StatusTag';
import { useJointActions } from '@/features/together/useJointActions';
import { errorMessage } from '@/lib/logger';
import { Button, Card, Divider, EmptyState, ErrorNotice, Icon, Loading, Screen, SectionHeader, SportBadge, Text, space, useTheme, type IconName } from '@/ui';

function InfoRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.info} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={18} color={colors.textMuted} />
      <View style={styles.flex}>
        <Text variant="overline" color="textMuted">
          {label}
        </Text>
        <Text variant="body">{value}</Text>
      </View>
    </View>
  );
}

function Hero({ session }: { session: JointSession }) {
  const theme = useTheme();
  return (
    <View style={styles.hero}>
      <SportBadge sport={session.sport} size={72} tone="solid" />
      <View style={styles.heroText}>
        <Text variant="overline" style={{ color: theme.sport(session.sport).base }}>
          {sportLabel(session.sport)} · Quedada
        </Text>
        <Text variant="display" accessibilityRole="header">
          {session.title}
        </Text>
        <View style={styles.tags}>
          <StatusTag copy={sessionStatusCopy(session.status)} />
          <IntensityTag intensity={session.intensity} />
        </View>
      </View>
    </View>
  );
}

function Actions({ session, myId }: { session: JointSession; myId: UUID | null }) {
  const actions = useJointActions(session);
  const me = myParticipant(session, myId);
  const organizer = isOrganizer(session, myId);
  const active = session.status !== 'cancelled';
  const invited = active && !organizer && me?.status === 'invited';
  return (
    <View style={styles.actions}>
      {invited ? (
        <View style={styles.row}>
          <Button label="Aceptar" icon="check" onPress={() => void actions.respond(true)} loading={actions.busy === 'accept'} disabled={actions.busy !== null} style={styles.flex} />
          <Button label="Rechazar" variant="secondary" onPress={() => void actions.respond(false)} loading={actions.busy === 'decline'} disabled={actions.busy !== null} style={styles.flex} />
        </View>
      ) : null}
      {me?.workoutId ? (
        <Button label="Ver mi entreno" icon="calendarBadge" variant="secondary" fullWidth onPress={() => openWorkout(me.workoutId as UUID)} />
      ) : null}
      {organizer && active ? (
        <Button label="Cancelar quedada" icon="close" variant="danger" fullWidth onPress={() => void actions.cancel()} loading={actions.busy === 'cancel'} />
      ) : null}
      {actions.error ? <ErrorNotice message={actions.error} /> : null}
    </View>
  );
}

export default function JointSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session: auth } = useAuth();
  const myId = auth?.userId ?? null;
  const query = useJointSession(id);
  const session = query.data ?? null;
  const today = todayISO();

  if (query.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando quedada" />
      </Screen>
    );
  }
  if (query.error || !session) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ title: 'Quedada' }} />
        {query.error ? (
          <ErrorNotice message={errorMessage(query.error, 'No se ha podido cargar la quedada.')} onRetry={() => void query.refetch()} />
        ) : (
          <EmptyState
            icon="together"
            title="Quedada no encontrada"
            message="Puede que la hayan cancelado o que ya no participes."
            action={<Button label="Volver a Juntos" onPress={() => router.replace('/together')} />}
          />
        )}
      </Screen>
    );
  }

  const isPast = session.date < today;
  return (
    <Screen inSheet onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <Stack.Screen options={{ title: session.title }} />
      <Hero session={session} />
      {session.status === 'cancelled' ? <ErrorNotice message="Esta quedada se ha cancelado." /> : null}
      <Card padding="lg">
        <InfoRow icon="week" label={isPast ? 'Fue el' : 'Día'} value={formatDayLong(session.date)} />
        <Divider />
        <InfoRow icon="clock" label="Hora" value={`${sessionTimeLabel(session)} · ${formatDuration(session.durationMin)}`} />
        {session.location ? (
          <>
            <Divider />
            <InfoRow icon="location" label="Lugar" value={session.location} />
          </>
        ) : null}
        {session.notes ? (
          <>
            <Divider />
            <InfoRow icon="info" label="Notas" value={session.notes} />
          </>
        ) : null}
      </Card>
      <View style={styles.section}>
        <SectionHeader title={`Participantes · ${session.participants.length}`} />
        {session.participants.map((participant, index) => (
          <View key={participant.userId}>
            {index > 0 ? <Divider inset={52} /> : null}
            <ParticipantRow
              participant={participant}
              isOrganizer={participant.userId === session.organizerId}
              isMe={participant.userId === myId}
            />
          </View>
        ))}
      </View>
      <Actions session={session} myId={myId} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md },
  heroText: { gap: space.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  flex: { flex: 1 },
  section: { gap: space.xs },
  actions: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
});
