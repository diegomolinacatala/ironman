import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { addDays, formatDayLabel } from '@/domain/dates';
import type { DateRange, ISODate, JointSession, UUID } from '@/domain/types';
import { useJointSessions } from '@/data/queries';
import { errorMessage } from '@/lib/logger';
import { Button, Card, Disclosure, ErrorNotice, Loading, SectionHeader, Text, space, useTheme } from '@/ui';

import { JointSessionRow } from './JointSessionRow';
import { splitSessions } from './jointModel';

const HORIZON_DAYS = 42;

/** Range of upcoming quedadas listed in Juntos (shared query key with the screen). */
export function upcomingJointRange(today: ISODate): DateRange {
  return { from: today, to: addDays(today, HORIZON_DAYS) };
}

export interface JointSessionsSectionProps {
  myId: UUID | null;
  today: ISODate;
  /** Available once the athlete has an accepted friend. */
  onPropose?: () => void;
}

/** Keep the next commitment in view, with a count for the rest. */
export function JointSessionsSection({ myId, today, onPropose }: JointSessionsSectionProps) {
  const { colors } = useTheme();
  const sessions = useJointSessions(upcomingJointRange(today));
  const { invites, upcoming } = splitSessions(sessions.data, myId, today);
  const firstInvite = invites[0];
  const next = upcoming[0];
  const renderSession = (session: JointSession) => (
    <JointSessionRow key={session.id} session={session} myId={myId} today={today} onPress={() => router.push(`/joint/${encodeURIComponent(session.id)}`)} />
  );
  if (sessions.isLoading) return <Loading label="Cargando quedadas" />;

  if (!sessions.error && !firstInvite && !next) {
    if (!onPropose) return null;
    return (
      <Card variant="tinted" tint={colors.accentSoft} padding="xl" style={styles.hero}>
        <Text variant="title" color="onAccentSoft">Vuestra próxima quedada</Text>
        <Text variant="callout" color="onAccentSoft">Elige un entreno y propón una hora a tus amigos.</Text>
        <Button label="Proponer quedada" icon="calendarPlus" fullWidth onPress={onPropose} style={styles.propose} />
      </Card>
    );
  }
  return (
    <View style={styles.section}>
      {sessions.error ? (
        <ErrorNotice
          message={errorMessage(sessions.error, 'No se han podido cargar las quedadas.')}
          onRetry={() => void sessions.refetch()}
        />
      ) : null}
      {firstInvite ? <SectionHeader title="Te han invitado" /> : null}
      {firstInvite ? renderSession(firstInvite) : null}
      {invites.length > 1 ? (
        <Disclosure title={invites.length === 2 ? 'Otra invitación por responder' : `${invites.length - 1} invitaciones más por responder`} icon="mail">
          {invites.slice(1).map(renderSession)}
        </Disclosure>
      ) : null}
      {next ? <SectionHeader title="Tu próxima quedada" /> : null}
      {next ? renderSession(next) : null}
      {upcoming.length > 1 ? (
        <Disclosure title={upcoming.length === 2 ? 'Una quedada más' : `${upcoming.length - 1} quedadas más`} summary={formatDayLabel(upcoming[1]!.date, today)} icon="week">
          {upcoming.slice(1).map(renderSession)}
        </Disclosure>
      ) : null}
      {onPropose ? <Button label="Proponer quedada" icon="calendarPlus" variant="secondary" onPress={onPropose} fullWidth /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  hero: { gap: space.sm },
  propose: { marginTop: space.sm },
});
