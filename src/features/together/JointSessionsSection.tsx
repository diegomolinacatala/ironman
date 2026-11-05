import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { addDays } from '@/domain/dates';
import type { DateRange, ISODate, UUID } from '@/domain/types';
import { useJointSessions } from '@/data/queries';
import { errorMessage } from '@/lib/logger';
import { ErrorNotice, Loading, SectionHeader, Text, fonts, space } from '@/ui';

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
  /** Opens the form (no prefill) — shown in the empty state. */
  onPropose?: () => void;
}

/** "Próximas quedadas": my pending invites first (with inline answers), then upcoming sessions. */
export function JointSessionsSection({ myId, today, onPropose }: JointSessionsSectionProps) {
  const sessions = useJointSessions(upcomingJointRange(today));
  const { invites, upcoming } = splitSessions(sessions.data, myId, today);
  const open = (id: UUID) => router.push(`/joint/${id}`);

  return (
    <View style={styles.section}>
      <SectionHeader title="Próximas quedadas" action={onPropose ? { label: 'Proponer', onPress: onPropose } : undefined} />
      {sessions.isLoading ? <Loading label="Cargando quedadas" /> : null}
      {sessions.error ? (
        <ErrorNotice
          message={errorMessage(sessions.error, 'No se han podido cargar las quedadas.')}
          onRetry={() => void sessions.refetch()}
        />
      ) : null}
      {!sessions.isLoading && !sessions.error && invites.length + upcoming.length === 0 ? (
        <Text variant="callout" color="textMuted">
          Sin quedadas a la vista. Propón una o búscala en los huecos comunes con tus amigos.
        </Text>
      ) : null}
      {invites.length > 0 ? (
        <Text variant="caption" color="accentInk" accessibilityRole="header" style={styles.subhead}>
          {invites.length === 1 ? 'Te han invitado' : `Te han invitado a ${invites.length}`}
        </Text>
      ) : null}
      {invites.map((session) => (
        <JointSessionRow key={session.id} session={session} myId={myId} today={today} onPress={() => open(session.id)} />
      ))}
      {upcoming.map((session) => (
        <JointSessionRow key={session.id} session={session} myId={myId} today={today} onPress={() => open(session.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  subhead: { fontFamily: fonts.bodySemibold },
});
