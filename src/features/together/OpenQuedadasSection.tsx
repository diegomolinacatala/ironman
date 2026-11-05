/**
 * "Quedadas abiertas": friends' open quedadas of the next two weeks that I can
 * join with one tap (the linked workout lands in my plan).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useJoinJointSession, useOpenJointSessions } from '@/data/queries';
import { addDays, formatDayLabel, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { ISODate, JointSession, UUID } from '@/domain/types';
import { firstName } from '@/features/social/friendModel';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, ErrorNotice, SectionHeader, SportBadge, Text, haptics, space } from '@/ui';

const WINDOW_DAYS = 14;

export function openRange(today: ISODate): { from: ISODate; to: ISODate } {
  return { from: today, to: addDays(today, WINDOW_DAYS) };
}

function organizerName(session: JointSession): string {
  const organizer = session.participants.find((p) => p.userId === session.organizerId);
  return firstName(organizer?.displayName ?? 'Un amigo');
}

export function openQuedadaLine(session: JointSession, today: ISODate): string {
  const when = `${formatDayLabel(session.date, today)}${session.startTime ? ` · ${session.startTime}` : ''}`;
  return [when, formatDuration(session.durationMin), session.location].filter(Boolean).join(' · ');
}

function OpenQuedadaCard({ session, today }: { session: JointSession; today: ISODate }) {
  const join = useJoinJointSession();
  const [error, setError] = useState<string | null>(null);
  const going = session.participants.filter((p) => p.status === 'accepted').length;
  const onJoin = async () => {
    setError(null);
    try {
      await join.mutateAsync(session.id);
      haptics.success();
    } catch (e) {
      logger.warn('join open quedada failed', e);
      setError(errorMessage(e, 'No te has podido apuntar.'));
    }
  };
  return (
    <Card padding="md" onPress={() => router.push(`/joint/${encodeURIComponent(session.id)}`)}>
      <View style={styles.row}>
        <SportBadge sport={session.sport} size={40} />
        <View style={styles.flex}>
          <Text variant="caption" color="textMuted">
            {organizerName(session)} · {sportLabel(session.sport)} · {going === 1 ? '1 apuntado' : `${going} apuntados`}
          </Text>
          <Text variant="bodyStrong">{session.title}</Text>
          <Text variant="caption" color="textMuted">
            {openQuedadaLine(session, today)}
          </Text>
        </View>
        <Button label="Me apunto" size="sm" icon="check" variant="secondary" onPress={() => void onJoin()} loading={join.isPending} />
      </View>
      {error ? <ErrorNotice message={error} /> : null}
    </Card>
  );
}

export function OpenQuedadasSection({ today }: { today: ISODate; myId?: UUID | null }) {
  const open = useOpenJointSessions(openRange(today));
  const sessions = open.data ?? [];
  if (sessions.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Quedadas abiertas" />
      {sessions.map((s) => (
        <OpenQuedadaCard key={s.id} session={s} today={today} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
});
