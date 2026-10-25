/**
 * Full week compare with one friend: two lanes per day, busy hatching, lime
 * common slots, opportunities and "Proponer quedada".
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useFriends, useProfile, useRemoveFriend } from '@/data/queries';
import { startOfWeek, todayISO } from '@/domain/dates';
import type { Friend, ISODate, UUID } from '@/domain/types';
import { confirmAction, showActionMenu, showNotice } from '@/features/social/confirm';
import { findAcceptedFriend, firstName } from '@/features/social/friendModel';
import { CompareDayCard } from '@/features/together/CompareDayCard';
import { defaultCompareWeek } from '@/features/together/compareModel';
import { CompareLegend } from '@/features/together/CompareLegend';
import { prefillFromOpportunity, prefillFromSlot } from '@/features/together/jointForm';
import { openJointNew, openWorkout } from '@/features/together/navigation';
import { OpportunityCard } from '@/features/together/OpportunityCard';
import { useTogetherWeek, type TogetherWeek } from '@/features/together/useTogetherWeek';
import { VisibilityNotice } from '@/features/together/VisibilityNotice';
import { WeekSwitcher } from '@/features/together/WeekSwitcher';
import { errorMessage, logger } from '@/lib/logger';
import { Avatar, Button, EmptyState, ErrorNotice, IconButton, Loading, Screen, SectionHeader, Text, space } from '@/ui';

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveWeek(raw: string | undefined, today: ISODate): ISODate {
  const current = startOfWeek(today);
  if (!raw || !WEEK_RE.test(raw)) return defaultCompareWeek(today);
  const week = startOfWeek(raw);
  return week < current ? current : week;
}

function useRemoveFlow(friend: Friend | null) {
  const remove = useRemoveFriend();
  return async () => {
    if (!friend) return;
    const name = friend.profile.displayName;
    const ok = await confirmAction({
      title: `¿Eliminar a ${name}?`,
      message: 'Dejaréis de ver vuestros calendarios y huecos. Las quedadas ya creadas se mantienen.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(friend.friendshipId);
      router.back();
    } catch (error) {
      logger.warn('remove friend failed', error);
      showNotice('No se ha podido eliminar', errorMessage(error));
    }
  };
}

function Header({ friend }: { friend: Friend }) {
  return (
    <View style={styles.header}>
      <Avatar name={friend.profile.displayName} size={48} />
      <View style={styles.headerText}>
        <Text variant="overline" color="textMuted">
          Tú y
        </Text>
        <Text variant="title" numberOfLines={1}>
          {friend.profile.displayName}
        </Text>
        <Text variant="caption" color="textMuted">
          @{friend.profile.username}
        </Text>
      </View>
    </View>
  );
}

interface WeekContentProps {
  data: TogetherWeek;
  friendId: UUID;
  friendName: string;
  myName: string | null;
  today: ISODate;
}

function WeekContent({ data, friendId, friendName, myName, today }: WeekContentProps) {
  return (
    <>
      {data.opportunities.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Oportunidades" />
          {data.opportunities.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              today={today}
              onPropose={() => openJointNew(prefillFromOpportunity(opportunity, friendId))}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.section}>
        <SectionHeader title={`${myName ? firstName(myName) : 'Tú'} y ${friendName}`} />
        <CompareLegend />
        {data.days.map((day) => (
          <CompareDayCard
            key={day.date}
            day={day}
            friendName={friendName}
            today={today}
            onOpenWorkout={(entry) => (entry.workout ? openWorkout(entry.workout.id) : undefined)}
            onProposeSlot={(slot) => openJointNew(prefillFromSlot(slot, friendId))}
          />
        ))}
      </View>
    </>
  );
}

export default function FriendWeekScreen() {
  const params = useLocalSearchParams<{ id: string; week?: string }>();
  const today = todayISO();
  const weekStart = resolveWeek(params.week, today);
  const friends = useFriends();
  const profile = useProfile();
  const friend = findAcceptedFriend(friends.data, params.id);
  const name = friend ? firstName(friend.profile.displayName) : 'Tu amigo';
  const data = useTogetherWeek(friend?.profile.id, weekStart, today);
  const confirmRemove = useRemoveFlow(friend);

  const headerOptions = {
    title: friend ? `Con ${name}` : 'Juntos',
    headerRight: friend
      ? () => (
          <IconButton
            icon="settings"
            accessibilityLabel="Opciones de amistad"
            onPress={() => showActionMenu(friend.profile.displayName, [{ label: 'Eliminar amigo', destructive: true, onSelect: () => void confirmRemove() }])}
          />
        )
      : undefined,
  };

  if (friends.isLoading) {
    return (
      <Screen inSheet>
        <Stack.Screen options={headerOptions} />
        <Loading label="Cargando" />
      </Screen>
    );
  }
  if (friends.error || !friend) {
    return (
      <Screen inSheet>
        <Stack.Screen options={headerOptions} />
        {friends.error ? (
          <ErrorNotice message={errorMessage(friends.error, 'No se han podido cargar tus amigos.')} onRetry={() => void friends.refetch()} />
        ) : (
          <EmptyState
            icon="together"
            title="No es tu amigo todavía"
            message="Solo puedes comparar la semana con amigos que hayan aceptado tu solicitud."
            action={<Button label="Añadir amigo" icon="add" onPress={() => router.replace('/friends/add')} />}
          />
        )}
      </Screen>
    );
  }

  const friendId = friend.profile.id;
  return (
    <Screen
      inSheet
      onRefresh={data.refetch}
      refreshing={data.isRefetching}
      footer={
        <Button
          label="Proponer quedada"
          icon="send"
          fullWidth
          size="lg"
          onPress={() => openJointNew({ friendId, date: weekStart > today ? weekStart : today })}
        />
      }>
      <Stack.Screen options={headerOptions} />
      <Header friend={friend} />
      <WeekSwitcher weekStart={weekStart} today={today} onChange={(week) => router.setParams({ week })} />
      <VisibilityNotice friendName={name} visibility={data.visibility} />
      {data.isLoading ? <Loading label={`Comparando con ${name}`} /> : null}
      {data.error ? (
        <ErrorNotice message={errorMessage(data.error, `No se ha podido cargar la semana de ${name}.`)} onRetry={data.refetch} />
      ) : null}

      {!data.isLoading && !data.error ? (
        <WeekContent data={data} friendId={friendId} friendName={name} myName={profile.data?.displayName ?? null} today={today} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1 },
  section: { gap: space.sm },
});
