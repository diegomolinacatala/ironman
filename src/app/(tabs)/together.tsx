/**
 * Juntos — friends, quedadas, common free slots (Huecos), opportunities, shared races and the
 * activity feed. A tab since the 2026-11 rebrand (Hoy · Plan · Juntos · Progreso · Tú).
 *
 * Order = most actionable first: friend requests → Proponer quedada / Añadir amigo → upcoming
 * quedadas (invites first) → friends' open quedadas; then folded sections (per-friend compare,
 * shared races, feed) so the screen stays calm.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useFeed, useFriends, useJointSessions, useNotifications, useProfile } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { Friend, ISODate, UUID } from '@/domain/types';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { FeedSection } from '@/features/social/FeedSection';
import { FriendRequestsCard } from '@/features/social/FriendRequestsCard';
import { FriendSelector } from '@/features/social/FriendSelector';
import { firstName, splitFriends } from '@/features/social/friendModel';
import { NoFriendsState } from '@/features/social/NoFriendsState';
import { NotificationsBell } from '@/features/social/NotificationsBell';
import { JointSessionsSection, upcomingJointRange } from '@/features/together/JointSessionsSection';
import { openJointNew } from '@/features/together/navigation';
import { OpenQuedadasSection } from '@/features/together/OpenQuedadasSection';
import { SharedRacesCard } from '@/features/together/SharedRacesCard';
import { TogetherPanel } from '@/features/together/TogetherPanel';
import { errorMessage } from '@/lib/logger';
import { Disclosure, ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

function overlineFor(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1 ? '1 amigo' : `${count} amigos`;
}

const goAdd = () => router.push('/friends/add');

interface FriendBlockProps {
  friends: readonly Friend[];
  selected: Friend;
  onSelect: (id: UUID) => void;
  myName: string;
  today: ISODate;
  showComparison: boolean;
}

/** "Tú y Álex": pick a friend (when there are several), then compare, Huecos, Oportunidades. */
function FriendBlock({ friends, selected, onSelect, myName, today, showComparison }: FriendBlockProps) {
  return (
    <View style={styles.friends}>
      <SectionHeader title="Tus amigos" action={{ label: 'Añadir amigo', onPress: goAdd }} />
      {friends.length > 1 ? <FriendSelector friends={friends} selectedId={selected.profile.id} onSelect={onSelect} /> : null}
      <Disclosure
        key={showComparison ? selected.profile.id : 'default'}
        title={`Buscar un hueco con ${firstName(selected.profile.displayName)}`}
        summary="Horarios y entrenos que os encajan"
        icon="calendarBadge"
        defaultOpen={showComparison}
        storageKey={showComparison ? undefined : 'together.compare'}>
        <TogetherPanel friend={selected} myName={myName} today={today} />
      </Disclosure>
    </View>
  );
}

export default function TogetherScreen() {
  const { session } = useAuth();
  const myId = session?.userId ?? null;
  const today = todayISO();
  const profile = useProfile();
  const friends = useFriends();
  const feed = useFeed();
  const notifications = useNotifications();
  const joint = useJointSessions(upcomingJointRange(today));
  const { accepted, incoming, outgoing } = splitFriends(friends.data);
  const { friend } = useLocalSearchParams<{ friend?: string }>();
  const picked = accepted.find((f) => f.profile.id === friend);
  const selected = picked ?? accepted[0];
  const invitee = picked ?? (accepted.length === 1 ? selected : undefined);
  const bottomPadding = useTabBottomPadding();
  const hasFriends = accepted.length > 0;

  const onRefresh = () => {
    void friends.refetch();
    void feed.refetch();
    void notifications.refetch();
    void joint.refetch();
  };

  return (
    <Screen
      title="Juntos"
      overline={overlineFor(accepted.length)}
      headerRight={<NotificationsBell />}
      onRefresh={onRefresh}
      refreshing={friends.isRefetching || feed.isRefetching || joint.isRefetching}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      {friends.isLoading ? <Loading label="Cargando amigos" /> : null}
      {friends.error ? (
        <ErrorNotice
          message={errorMessage(friends.error, 'No se han podido cargar tus amigos.')}
          onRetry={() => void friends.refetch()}
        />
      ) : null}

      <FriendRequestsCard requests={incoming} />

      {!friends.isLoading && !friends.error && !hasFriends ? (
        <NoFriendsState username={profile.data?.username ?? null} pendingOutgoing={outgoing.length} onAdd={goAdd} />
      ) : null}

      <JointSessionsSection myId={myId} today={today} onPropose={hasFriends ? () => openJointNew(invitee ? { friendId: invitee.profile.id } : {}) : undefined} />
      {selected ? (
        <FriendBlock
          friends={accepted}
          selected={selected}
          onSelect={(id) => router.setParams({ friend: id })}
          showComparison={Boolean(picked)}
          myName={profile.data?.displayName ?? 'Yo'}
          today={today}
        />
      ) : null}
      {hasFriends ? <OpenQuedadasSection today={today} /> : null}
      {hasFriends ? <SharedRacesCard today={today} folded /> : null}
      {hasFriends ? (
        <Disclosure icon="pulse" title="Actividad" summary="Los últimos entrenos de tus amigos" storageKey="together.feed">
          <FeedSection myId={myId} today={today} hideHeader />
        </Disclosure>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  friends: { gap: space.md },
});
