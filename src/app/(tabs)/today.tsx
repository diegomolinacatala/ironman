import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { isoWeekNumber } from '@/domain/dates';
import type { Workout } from '@/domain/types';
import { needsInlineAccessory } from '@/features/accessory/coachActions';
import { CoachAccessory } from '@/features/accessory/CoachAccessory';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { BriefingCard } from '@/features/briefing/BriefingCard';
import { Appear } from '@/features/today/Appear';
import { Banners } from '@/features/today/Banners';
import { MealsStrip } from '@/features/today/MealsStrip';
import { RaceChip } from '@/features/today/RaceChip';
import { TodayHeader } from '@/features/today/TodayHeader';
import { TodaySessionSection } from '@/features/today/TodaySessionSection';
import { dateLine, greeting } from '@/features/today/todayModel';
import { TomorrowStrip } from '@/features/today/TomorrowStrip';
import { useTodayData } from '@/features/today/useTodayData';
import { useActionSheet } from '@/features/workouts/actionSheet';
import { CompleteSheet } from '@/features/workouts/CompleteSheet';
import { MoveSheet } from '@/features/workouts/MoveSheet';
import { useWorkoutActions } from '@/features/workouts/useWorkoutActions';
import { Screen, space } from '@/ui';

/**
 * Hoy (v2): greeting, race chip, the "Informe de hoy" hero, today's session, today's meals and
 * tomorrow. Talking to the coach lives in the tab-bar accessory.
 */
export default function TodayScreen() {
  const data = useTodayData();
  const actions = useWorkoutActions();
  const sheet = useActionSheet();
  const bottomPadding = useTabBottomPadding();
  const [completing, setCompleting] = useState<Workout | null>(null);
  const [moving, setMoving] = useState<Workout | null>(null);
  const { today } = data;

  const openMore = (workout: Workout) =>
    sheet.open({
      title: workout.title,
      actions: [
        { label: 'Mover a otro día', icon: 'move', onPress: () => setMoving(workout) },
        { label: 'Saltar', icon: 'skip', onPress: () => void actions.skip(workout) },
      ],
    });

  return (
    <Screen
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      <Appear index={0} style={styles.header}>
        <TodayHeader
          greeting={greeting(data.displayName)}
          dateLine={`${dateLine(today)} · Semana ${isoWeekNumber(today)}`}
          unread={data.unread}
        />
        {data.racesReady ? <RaceChip race={data.race} phase={data.phase} today={today} /> : null}
      </Appear>
      {needsInlineAccessory() ? (
        <Appear index={1}>
          <CoachAccessory placement="regular" surface="card" />
        </Appear>
      ) : null}
      <Banners invites={data.invites} proposals={data.proposals} today={today} />

      <Appear index={2}>
        <BriefingCard date={today} />
      </Appear>
      <Appear index={3}>
        <TodaySessionSection data={data} busy={actions.busy} onComplete={setCompleting} onMore={openMore} />
      </Appear>
      <Appear index={4}>
        <MealsStrip date={today} meals={data.meals} />
      </Appear>
      {!data.isLoading && !data.error ? (
        <Appear index={5}>
          <TomorrowStrip date={data.tomorrow} workouts={data.tomorrowWorkouts} />
        </Appear>
      ) : null}

      {completing ? (
        <CompleteSheet key={completing.id} workout={completing} visible onClose={() => setCompleting(null)} />
      ) : null}
      {moving ? (
        <MoveSheet
          visible
          onClose={() => setMoving(null)}
          fromDate={moving.date}
          today={today}
          busy={actions.busy}
          onSelect={(date) => {
            void actions.moveTo(moving, date).then((ok) => {
              if (ok) setMoving(null);
            });
          }}
        />
      ) : null}
      {sheet.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.md },
});
