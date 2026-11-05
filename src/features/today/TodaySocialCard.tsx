/**
 * Hoy · today's quedadas only. Discovery (friends' activity, open quedadas, huecos) lives in
 * the Juntos tab, so this section is hidden when you don't train with anyone today.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ISODate, JointSession, UUID } from '@/domain/types';
import { joinNames } from '@/features/social/feedText';
import { firstName } from '@/features/social/friendModel';
import { todaySocial } from '@/features/together/sharedModel';
import { Card, Divider, Icon, SectionHeader, Text, iconSize, space, useTheme } from '@/ui';

const TILE_SIZE = 32;
const TILE_INSET = TILE_SIZE + space.md;

function partnersOf(session: JointSession, myId: UUID | null): string {
  const names = session.participants
    .filter((p) => p.userId !== myId && p.status === 'accepted')
    .map((p) => firstName(p.displayName));
  return names.length > 0 ? joinNames(names) : 'tus amigos';
}

/** Today's accepted, non-cancelled quedadas (the feed and open quedadas are Juntos-tab content). */
export function todayQuedadas(myId: UUID | null, today: ISODate, jointSessions: readonly JointSession[], now: Date): JointSession[] {
  return todaySocial({ myId, today, now, joint: jointSessions, feed: [], open: [] }).todayJoint;
}

function QuedadaLine({ session, myId }: { session: JointSession; myId: UUID | null }) {
  const { colors } = useTheme();
  const text = `Hoy entrenas con ${partnersOf(session, myId)}${session.startTime ? ` a las ${session.startTime}` : ''}`;
  const detail = [session.title, session.location].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${text}. ${detail}` : text}
      onPress={() => router.push(`/joint/${encodeURIComponent(session.id)}`)}
      style={({ pressed }) => [styles.line, pressed && { backgroundColor: colors.surfacePressed }]}>
      <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
        <Icon name="together" size={iconSize.sm} color={colors.onAccentSoft} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{text}</Text>
        {detail ? (
          <Text variant="caption" color="textMuted">
            {detail}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

export interface TodaySocialCardProps {
  myId: UUID | null;
  today: ISODate;
  jointSessions: readonly JointSession[];
  now?: Date;
}

export function TodaySocialCard({ myId, today, jointSessions, now = new Date() }: TodaySocialCardProps) {
  const sessions = todayQuedadas(myId, today, jointSessions, now);
  if (sessions.length === 0) return null;
  return (
    <View style={styles.root}>
      <SectionHeader title="Juntos hoy" action={{ label: 'Ver Juntos', onPress: () => router.navigate('/together') }} />
      <Card padding="sm">
        {sessions.map((s, i) => (
          <View key={s.id}>
            {i > 0 ? <Divider inset={TILE_INSET + space.sm} /> : null}
            <QuedadaLine session={s} myId={myId} />
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: 10, minHeight: 48 },
  tile: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
});
