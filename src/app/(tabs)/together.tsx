/**
 * Juntos — friends, common free slots (Huecos), opportunities, quedadas and
 * the activity feed.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useFeed, useFriends, useJointSessions, useNotifications, useProfile } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { UUID } from '@/domain/types';
import { FeedSection } from '@/features/social/FeedSection';
import { FriendRequestsCard } from '@/features/social/FriendRequestsCard';
import { FriendSelector } from '@/features/social/FriendSelector';
import { splitFriends } from '@/features/social/friendModel';
import { NoFriendsState } from '@/features/social/NoFriendsState';
import { NotificationsBell } from '@/features/social/NotificationsBell';
import { JointSessionsSection, upcomingJointRange } from '@/features/together/JointSessionsSection';
import { openJointNew } from '@/features/together/navigation';
import { TogetherPanel } from '@/features/together/TogetherPanel';
import { errorMessage } from '@/lib/logger';
import { ErrorNotice, Loading, Screen, space } from '@/ui';

function overlineFor(count: number): string {
  if (count === 0) return 'Entrena en compañía';
  return count === 1 ? '1 amigo' : `${count} amigos`;
}

export default function TogetherScreen() {
  const params = useLocalSearchParams<{ friend?: string }>();
  const { session } = useAuth();
  const myId = session?.userId ?? null;
  const today = todayISO();
  const profile = useProfile();
  const friends = useFriends();
  const feed = useFeed();
  const notifications = useNotifications();
  const joint = useJointSessions(upcomingJointRange(today));
  const { accepted, incoming, outgoing } = splitFriends(friends.data);
  const [picked, setPicked] = useState<UUID | null>(params.friend ?? null);
  const selected = accepted.find((f) => f.profile.id === picked) ?? accepted[0] ?? null;
  const myName = profile.data?.displayName ?? 'Yo';
  const goAdd = () => router.push('/friends/add');

  const refreshing = friends.isRefetching || feed.isRefetching || joint.isRefetching;
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
      refreshing={refreshing}>
      {friends.isLoading ? <Loading label="Cargando amigos" /> : null}
      {friends.error ? (
        <ErrorNotice
          message={errorMessage(friends.error, 'No se han podido cargar tus amigos.')}
          onRetry={() => void friends.refetch()}
        />
      ) : null}

      <FriendRequestsCard requests={incoming} />

      {!friends.isLoading && !friends.error && accepted.length === 0 ? (
        <NoFriendsState username={profile.data?.username ?? null} pendingOutgoing={outgoing.length} onAdd={goAdd} />
      ) : null}

      {selected ? (
        <View style={styles.block}>
          <FriendSelector friends={accepted} selectedId={selected.profile.id} onSelect={setPicked} onAdd={goAdd} />
          <TogetherPanel friend={selected} myName={myName} today={today} />
        </View>
      ) : null}

      {accepted.length > 0 ? (
        <JointSessionsSection
          myId={myId}
          today={today}
          onPropose={() => openJointNew(selected ? { friendId: selected.profile.id } : {})}
        />
      ) : null}

      {accepted.length > 0 ? <FeedSection myId={myId} today={today} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.lg },
});
