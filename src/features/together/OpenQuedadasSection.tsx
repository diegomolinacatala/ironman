/**
 * "Quedadas abiertas": friends' open quedadas of the next two weeks that I can
 * join with one tap (the linked workout lands in my plan).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useJoinJointSession, useOpenJointSessions } from '@/data/queries';
import { addDays, formatDayLabel, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { ISODate, JointSession } from '@/domain/types';
import { firstName } from '@/features/social/friendModel';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, Disclosure, ErrorNotice, SportBadge, Text, haptics, space } from '@/ui';

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
    <Card padding="md" style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${session.title}. ${openQuedadaLine(session, today)}. Ver quedada`}
        onPress={() => router.push(`/joint/${encodeURIComponent(session.id)}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
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
      </Pressable>
      <Button label="Me apunto" icon="check" variant="secondary" onPress={() => void onJoin()} loading={join.isPending} />
      {error ? <ErrorNotice message={error} /> : null}
    </Card>
  );
}

export function OpenQuedadasSection({ today }: { today: ISODate }) {
  const open = useOpenJointSessions(openRange(today));
  const sessions = open.data ?? [];
  if (open.error) return <ErrorNotice message={errorMessage(open.error, 'No se han podido cargar las quedadas abiertas.')} onRetry={() => void open.refetch()} />;
  const first = sessions[0];
  if (!first) return null;
  return (
    <Disclosure title="Quedadas abiertas" icon="together" summary={`${sessions.length === 1 ? '1 disponible' : `${sessions.length} disponibles`} · ${first.title}`}>
      {sessions.map((s) => (
        <OpenQuedadaCard key={s.id} session={s} today={today} />
      ))}
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.md },
  pressed: { opacity: 0.8 },
  flex: { flex: 1, gap: 2 },
});
