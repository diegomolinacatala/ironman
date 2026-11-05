/**
 * Juntos — friends, quedadas, common free slots (Huecos), opportunities, shared races and the
 * activity feed. A tab since the 2026-11 rebrand (Hoy · Plan · Juntos · Progreso · Tú).
 *
 * Order = most actionable first: friend requests → Proponer quedada / Añadir amigo → upcoming
 * quedadas (invites first) → friends' open quedadas → per-friend compare → shared races → feed.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { Button, ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

function overlineFor(count: number): string {
  if (count === 0) return 'Entrena en compañía';
  return count === 1 ? '1 amigo' : `${count} amigos`;
}

const goAdd = () => router.push('/friends/add');

/** The screen's single primary action plus "Añadir amigo". */
function QuickActions({ selected }: { selected: Friend | null }) {
  return (
    <View style={styles.actions}>
      <Button
        label="Proponer quedada"
        icon="send"
        onPress={() => openJointNew(selected ? { friendId: selected.profile.id } : {})}
        style={styles.flex}
      />
      <Button label="Añadir amigo" icon="add" variant="secondary" onPress={goAdd} />
    </View>
  );
}

interface FriendBlockProps {
  friends: readonly Friend[];
  selected: Friend;
  onSelect: (id: UUID) => void;
  myName: string;
  today: ISODate;
}

/** "Tú y Álex": pick a friend (when there are several), then compare, Huecos, Oportunidades. */
function FriendBlock({ friends, selected, onSelect, myName, today }: FriendBlockProps) {
  return (
    <View style={styles.section}>
      <SectionHeader title={`Tú y ${firstName(selected.profile.displayName)}`} />
      {friends.length > 1 ? <FriendSelector friends={friends} selectedId={selected.profile.id} onSelect={onSelect} /> : null}
      <TogetherPanel friend={selected} myName={myName} today={today} />
    </View>
  );
}

/** Selected friend: `?friend=` deep link, else the last pick, else the first friend. */
function useSelectedFriend(accepted: readonly Friend[]) {
  const params = useLocalSearchParams<{ friend?: string }>();
  const [picked, setPicked] = useState<UUID | null>(params.friend ?? null);
  // A tab stays mounted: later deep links (`/together?friend=…`) must still change the selection.
  useEffect(() => {
    if (params.friend) setPicked(params.friend);
  }, [params.friend]);
  const selected = accepted.find((f) => f.profile.id === picked) ?? accepted[0] ?? null;
  return { selected, setPicked };
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
  const { selected, setPicked } = useSelectedFriend(accepted);
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

      {hasFriends ? <QuickActions selected={selected} /> : null}
      {hasFriends ? <JointSessionsSection myId={myId} today={today} /> : null}
      {hasFriends ? <OpenQuedadasSection today={today} /> : null}
      {selected ? (
        <FriendBlock
          friends={accepted}
          selected={selected}
          onSelect={setPicked}
          myName={profile.data?.displayName ?? 'Yo'}
          today={today}
        />
      ) : null}
      {hasFriends ? <SharedRacesCard today={today} /> : null}
      {hasFriends ? <FeedSection myId={myId} today={today} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  section: { gap: space.md },
});
