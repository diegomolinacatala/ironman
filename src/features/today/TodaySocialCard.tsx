/**
 * Hoy · Juntos at a glance: today's quedada, what friends did in the last 24 h
 * and friends' open quedadas. Hidden without friends; a quiet link otherwise.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useFeed, useFriends, useOpenJointSessions } from '@/data/queries';
import type { ISODate, JointSession, UUID } from '@/domain/types';
import { describeFeedItem, joinNames } from '@/features/social/feedText';
import { firstName, splitFriends } from '@/features/social/friendModel';
import { relativeTime } from '@/features/social/relativeTime';
import { openQuedadaLine, openRange } from '@/features/together/OpenQuedadasSection';
import { hasTodaySocial, todaySocial } from '@/features/together/sharedModel';
import { Card, Icon, Text, space, useTheme, type IconName } from '@/ui';

const FEED_LIMIT = 10;

function Line({ icon, text, detail, onPress }: { icon: IconName; text: string; detail?: string | null; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${text}. ${detail}` : text}
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={18} color={colors.accentInk} />
      <View style={styles.flex}>
        <Text variant="callout">{text}</Text>
        {detail ? (
          <Text variant="caption" color="textMuted">
            {detail}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function partnersOf(session: JointSession, myId: UUID | null): string {
  const names = session.participants
    .filter((p) => p.userId !== myId && p.status === 'accepted')
    .map((p) => firstName(p.displayName));
  return names.length > 0 ? joinNames(names) : 'tus amigos';
}

function organizerOf(session: JointSession): string {
  return firstName(session.participants.find((p) => p.userId === session.organizerId)?.displayName ?? 'Un amigo');
}

export interface TodaySocialCardProps {
  myId: UUID | null;
  today: ISODate;
  jointSessions: readonly JointSession[];
  now?: Date;
}

export function TodaySocialCard({ myId, today, jointSessions, now = new Date() }: TodaySocialCardProps) {
  const friends = useFriends();
  const { accepted } = splitFriends(friends.data);
  const feed = useFeed(FEED_LIMIT);
  const open = useOpenJointSessions(openRange(today));
  if (accepted.length === 0) return null;

  const social = todaySocial({ myId, today, now, joint: jointSessions, feed: feed.data ?? [], open: open.data ?? [] });
  const goTogether = () => router.push('/together');
  const goJoint = (id: UUID) => router.push(`/joint/${encodeURIComponent(id)}`);

  if (!hasTodaySocial(social)) {
    const name = accepted.length === 1 ? firstName(accepted[0]?.profile.displayName ?? '') : null;
    return (
      <Card padding="md">
        <Line
          icon="together"
          text={name ? `Busca un hueco para entrenar con ${name}` : 'Busca un hueco para entrenar con tus amigos'}
          detail="Juntos · huecos comunes y quedadas"
          onPress={goTogether}
        />
      </Card>
    );
  }

  return (
    <Card padding="md">
      <View style={styles.box}>
        <Text variant="overline" color="textMuted">
          Juntos
        </Text>
        {social.todayJoint.map((s) => (
          <Line
            key={s.id}
            icon="calendarCheck"
            text={`Hoy entrenas con ${partnersOf(s, myId)}${s.startTime ? ` a las ${s.startTime}` : ''}`}
            detail={[s.title, s.location].filter(Boolean).join(' · ')}
            onPress={() => goJoint(s.id)}
          />
        ))}
        {social.recent.map((item) => {
          const text = describeFeedItem(item, myId, today);
          return (
            <Line
              key={item.id}
              icon="fire"
              text={`${text.actor} ${text.action}`}
              detail={[text.detail, relativeTime(item.createdAt, now)].filter(Boolean).join(' · ')}
              onPress={goTogether}
            />
          );
        })}
        {social.open.map((s) => (
          <Line
            key={s.id}
            icon="calendarPlus"
            text={`${organizerOf(s)} abre una quedada: ${s.title}`}
            detail={openQuedadaLine(s, today)}
            onPress={() => goJoint(s.id)}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  flex: { flex: 1, gap: 2 },
});
