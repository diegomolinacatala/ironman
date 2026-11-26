import { useState } from 'react';
import { StyleSheet } from 'react-native';

import type { Workout } from '@/domain/types';
import { needsInlineAccessory } from '@/features/accessory/coachActions';
import { CoachAccessory } from '@/features/accessory/CoachAccessory';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { BriefingCard } from '@/features/briefing/BriefingCard';
import { AdaptNudgeCard } from '@/features/today/AdaptNudgeCard';
import { OfflineNotice } from '@/features/offline/OfflineNotice';
import { Appear } from '@/features/today/Appear';
import { Banners } from '@/features/today/Banners';
import { MealsStrip } from '@/features/today/MealsStrip';
import { moreSheetConfig } from '@/features/today/moreSheet';
import { QuickActions } from '@/features/today/QuickActions';
import { TodayHeader } from '@/features/today/TodayHeader';
import { TodaySessionSection } from '@/features/today/TodaySessionSection';
import { TodaySocialCard } from '@/features/today/TodaySocialCard';
import { dateLine, greeting, mealsSummary, raceCountdownLine, tomorrowSummary } from '@/features/today/todayModel';
import { TomorrowStrip } from '@/features/today/TomorrowStrip';
import { useTodayData } from '@/features/today/useTodayData';
import { useActionSheet } from '@/features/workouts/actionSheet';
import { easierPatch } from '@/features/workouts/coachAdapters';
import { CompleteSheet } from '@/features/workouts/CompleteSheet';
import { MoveSheet } from '@/features/workouts/MoveSheet';
import { useWorkoutActions } from '@/features/workouts/useWorkoutActions';
import { formatDayShort } from '@/domain/dates';
import { useBriefing } from '@/data/queries';
import { todayQuedadas } from '@/features/today/TodaySocialCard';
import { Disclosure, Screen, space, useTheme } from '@/ui';

/**
 * Hoy, calm by default: greeting + countdown, three quick actions, what needs an answer
 * (banners), today's session (details folded), and folded sections for the morning report,
 * meals, tomorrow and today's quedadas. Talking to the coach lives in the tab-bar accessory
 * (inline here where there is none).
 */
export default function TodayScreen() {
  const data = useTodayData();
  const actions = useWorkoutActions();
  const sheet = useActionSheet();
  const bottomPadding = useTabBottomPadding();
  const [completing, setCompleting] = useState<Workout | null>(null);
  const [moving, setMoving] = useState<Workout | null>(null);
  const { today } = data;
  const inlineAccessory = needsInlineAccessory();
  const { colors } = useTheme();
  const quedadas = todayQuedadas(data.myId ?? null, today, data.jointSessions, new Date());
  const countdown = data.racesReady ? raceCountdownLine(data.race, today) : null;
  // The closed fold says what the report says ("Dormiste 7 h 20' · Hoy rodaje suave 50'").
  const briefingHeadline = useBriefing(today).data?.headline ?? null;

  const openMore = (workout: Workout) =>
    sheet.open(
      moreSheetConfig(workout, easierPatch(workout, data.thresholds), {
        onEasier: (patch) => void actions.easier(workout, patch),
        onMove: () => setMoving(workout),
        onSkip: () => void actions.skip(workout),
      }),
    );

  return (
    <Screen
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}
      contentStyle={[styles.content, bottomPadding != null ? { paddingBottom: bottomPadding } : null]}>
      <Appear index={0} style={styles.header}>
        <TodayHeader
          greeting={greeting(data.displayName)}
          dateLine={dateLine(today)}
          countdown={countdown}
          unread={data.unread}
        />
        <QuickActions checkinDone={data.checkinDone} showMeal={!inlineAccessory} />
      </Appear>
      {inlineAccessory ? (
        <Appear index={1}>
          <CoachAccessory placement="regular" surface="card" />
        </Appear>
      ) : null}
      <OfflineNotice />
      <Banners invites={data.invites} proposals={data.proposals} today={today} />
      {data.isLoading ? null : <AdaptNudgeCard today={today} checkinDone={data.checkinDone} />}

      <Appear index={2}>
        <TodaySessionSection data={data} busy={actions.busy} onComplete={setCompleting} onMore={openMore} />
      </Appear>

      <Appear index={3} style={styles.folds}>
        <Disclosure
          title="Informe de hoy"
          summary={briefingHeadline ?? 'Cómo has dormido y qué toca'}
          icon="sunrise"
          iconTint={colors.accentSoft}
          iconColor={colors.onAccentSoft}
          storageKey="today.briefing">
          <BriefingCard date={today} embedded />
        </Disclosure>
        {!data.isLoading && !data.error ? (
          <Disclosure
            title={`Mañana · ${formatDayShort(data.tomorrow)}`}
            summary={tomorrowSummary(data.tomorrowWorkouts)}
            icon="week"
            storageKey="today.tomorrow">
            <TomorrowStrip date={data.tomorrow} workouts={data.tomorrowWorkouts} embedded />
          </Disclosure>
        ) : null}
        <Disclosure title="Comidas de hoy" summary={mealsSummary(data.meals)} icon="food" storageKey="today.meals">
          <MealsStrip date={today} meals={data.meals} embedded />
        </Disclosure>
        {quedadas.length > 0 ? (
          <Disclosure
            title="Juntos hoy"
            summary={quedadas.length === 1 ? 'Hoy entrenas con amigos' : `${quedadas.length} quedadas hoy`}
            icon="together"
            defaultOpen
            storageKey="today.together">
            <TodaySocialCard myId={data.myId ?? null} today={today} jointSessions={data.jointSessions} embedded />
          </Disclosure>
        ) : null}
      </Appear>

      {completing ? (
        <CompleteSheet
          key={completing.id}
          workout={completing}
          raceDistance={data.raceDistance}
          visible
          onClose={() => setCompleting(null)}
        />
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
  content: { gap: space.xl },
  header: { gap: space.lg },
  folds: { gap: space.sm },
});
