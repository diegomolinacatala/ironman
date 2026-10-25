/**
 * Quedada card for lists: sport, title, when, who, status — and inline
 * Aceptar / Rechazar when the invitation is waiting for me.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDayLabel, formatDuration } from '@/domain/dates';
import type { ISODate, JointSession, UUID } from '@/domain/types';
import { useRespondJointSession } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Avatar, Button, Card, SportBadge, Text, haptics, space, useTheme } from '@/ui';

import { isPendingInviteForMe, otherParticipants, sessionStatusCopy, sessionTimeLabel, withNames } from './jointModel';
import { StatusTag } from './StatusTag';

export interface JointSessionRowProps {
  session: JointSession;
  myId: UUID | null;
  today: ISODate;
  onPress: () => void;
}

const MAX_AVATARS = 3;

function InviteActions({ sessionId }: { sessionId: UUID }) {
  const respond = useRespondJointSession();
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (accept: boolean) => {
    setPending(accept ? 'accept' : 'decline');
    setError(null);
    try {
      await respond.mutateAsync({ id: sessionId, accept });
      if (accept) haptics.success();
    } catch (e) {
      logger.warn('respond joint session failed', e);
      setError(errorMessage(e, 'No se ha podido responder a la quedada.'));
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.actionsWrap}>
      <View style={styles.actions}>
        <Button label="Aceptar" icon="check" onPress={() => void answer(true)} loading={pending === 'accept'} disabled={pending !== null} style={styles.action} />
        <Button label="Rechazar" variant="secondary" onPress={() => void answer(false)} loading={pending === 'decline'} disabled={pending !== null} style={styles.action} />
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function JointSessionRow({ session, myId, today, onPress }: JointSessionRowProps) {
  const theme = useTheme();
  const others = otherParticipants(session, myId);
  const invite = isPendingInviteForMe(session, myId);
  const when = `${formatDayLabel(session.date, today)} · ${sessionTimeLabel(session)} · ${formatDuration(session.durationMin)}`;
  const withText = others.length > 0 ? `Con ${withNames(others)}` : 'Solo tú por ahora';
  return (
    <Card padding="md" rail={theme.sport(session.sport).base}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Quedada ${session.title}, ${when}. ${withText}. ${sessionStatusCopy(session.status).label}`}
        accessibilityHint="Abre el detalle de la quedada"
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <SportBadge sport={session.sport} size={40} />
        <View style={styles.text}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {session.title}
          </Text>
          <Text variant="caption" color="textMuted">
            {when}
          </Text>
          <View style={styles.people}>
            <View style={styles.avatars}>
              {others.slice(0, MAX_AVATARS).map((p, i) => (
                <View key={p.userId} style={[styles.avatarRing, { borderColor: theme.colors.surface, marginLeft: i === 0 ? 0 : -8 }]}>
                  <Avatar name={p.displayName} size={22} />
                </View>
              ))}
            </View>
            <Text variant="caption" color="textMuted" numberOfLines={1} style={styles.flex}>
              {withText}
            </Text>
          </View>
        </View>
        {invite ? null : <StatusTag copy={sessionStatusCopy(session.status)} />}
      </Pressable>
      {invite ? <InviteActions sessionId={session.id} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  pressed: { opacity: 0.85 },
  text: { flex: 1, gap: 2 },
  people: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  avatars: { flexDirection: 'row' },
  avatarRing: { borderWidth: 2, borderRadius: 13 },
  flex: { flex: 1 },
  actionsWrap: { gap: space.xs, marginTop: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
});
