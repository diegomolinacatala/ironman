import { router } from 'expo-router';
import { useState } from 'react';

import { isoWeekNumber } from '@/domain/dates';
import type { Workout } from '@/domain/types';
import { Banners } from '@/features/today/Banners';
import { BellButton } from '@/features/today/BellButton';
import { DayStatusCard } from '@/features/today/DayStatusCard';
import { HeroSession } from '@/features/today/HeroSession';
import { RaceChip } from '@/features/today/RaceChip';
import { ReadinessCard } from '@/features/today/ReadinessCard';
import { planForToday, todayHeadline } from '@/features/today/selectors';
import { TomorrowStrip } from '@/features/today/TomorrowStrip';
import { useTodayData } from '@/features/today/useTodayData';
import { CompleteSheet } from '@/features/workouts/CompleteSheet';
import { partnerNameFor } from '@/features/workouts/draft';
import { FUELING_MIN_DURATION, FuelingHint } from '@/features/workouts/FuelingHint';
import { MoveSheet } from '@/features/workouts/MoveSheet';
import { useWorkoutActions } from '@/features/workouts/useWorkoutActions';
import { WorkoutCard } from '@/features/workouts/WorkoutCard';
import { errorMessage } from '@/lib/logger';
import { Button, ErrorNotice, Loading, Screen, SectionHeader, Stack } from '@/ui';

export default function TodayScreen() {
  const data = useTodayData();
  const actions = useWorkoutActions();
  const [completing, setCompleting] = useState<Workout | null>(null);
  const [moving, setMoving] = useState<Workout | null>(null);
  const { today } = data;
  const plan = planForToday(data.todayWorkouts, today);
  const partner = (w: Workout) => partnerNameFor(w, data.jointSessions, data.myId);

  return (
    <Screen
      overline={`${todayHeadline(today)} · Semana ${isoWeekNumber(today)}`}
      title="Hoy"
      headerRight={<BellButton unread={data.unread} />}
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}>
      {data.racesReady ? <RaceChip race={data.race} phase={data.phase} today={today} /> : null}
      <Banners invites={data.invites} proposals={data.proposals} today={today} />

      {data.isLoading ? <Loading label="Cargando tu día" /> : null}
      {data.error ? <ErrorNotice message={errorMessage(data.error)} onRetry={() => void data.refresh()} /> : null}

      {!data.isLoading && !data.error ? (
        <>
          {plan.hero ? (
            <HeroSession
              workout={plan.hero}
              partnerName={partner(plan.hero)}
              onOpen={() => router.push(`/workout/${plan.hero?.id ?? ''}`)}
              onComplete={() => setCompleting(plan.hero)}
              onSkip={() => {
                if (plan.hero) void actions.skip(plan.hero);
              }}
              onMove={() => setMoving(plan.hero)}
              busy={actions.busy}
            />
          ) : (
            <DayStatusCard kind={plan.isRestDay ? 'rest' : 'done'} today={today} />
          )}
          {plan.hero && plan.hero.durationMin >= FUELING_MIN_DURATION ? <FuelingHint workout={plan.hero} /> : null}
          {plan.others.length > 0 ? (
            <Stack gap="sm">
              <SectionHeader title={plan.hero ? 'También hoy' : 'Hoy'} />
              {plan.others.map((w) => (
                <WorkoutCard
                  key={w.id}
                  workout={w}
                  compact
                  today={today}
                  partnerName={partner(w)}
                  onPress={() => router.push(`/workout/${w.id}`)}
                />
              ))}
            </Stack>
          ) : null}
        </>
      ) : null}

      <ReadinessCard readiness={data.readiness} hasCheckin={data.checkin != null} />

      <Button
        label="Ha surgido algo"
        icon="bolt"
        variant="secondary"
        size="lg"
        fullWidth
        onPress={() => router.push(`/event/edit?date=${today}`)}
        accessibilityHint="Apunta un imprevisto: pádel, lesión, trabajo, viaje… y reorganiza tu semana"
      />

      {!data.isLoading && !data.error ? <TomorrowStrip date={data.tomorrow} workouts={data.tomorrowWorkouts} /> : null}

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
    </Screen>
  );
}
