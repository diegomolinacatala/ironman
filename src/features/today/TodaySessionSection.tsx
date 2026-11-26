import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Workout } from '@/domain/types';
import { Skeleton } from '@/features/briefing/Skeleton';
import { partnerNameFor } from '@/features/workouts/draft';
import { WorkoutCard } from '@/features/workouts/WorkoutCard';
import { useSessionWeather } from '@/features/weather/useSessionWeather';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage } from '@/lib/logger';
import { Card, Disclosure, ErrorNotice, radius, space } from '@/ui';

import { DayStatusCard } from './DayStatusCard';
import { planForToday } from './selectors';
import { TodaySession } from './TodaySession';
import type { TodayData } from './useTodayData';

export interface TodaySessionSectionProps {
  data: TodayData;
  busy: boolean;
  onMore: (workout: Workout) => void;
}

function SessionSkeleton() {
  return (
    <Card variant="raised" padding="lg" style={styles.skeleton}>
      <Skeleton width="40%" height={12} />
      <Skeleton width="35%" height={36} radius={radius.sm} />
      <Skeleton width="80%" height={18} />
      <Skeleton height={48} radius={radius.md} />
    </Card>
  );
}

/** "Tu entreno de hoy": next session, rest / done states and the rest of today's sessions. */
export function TodaySessionSection({ data, busy, onMore }: TodaySessionSectionProps) {
  const calendar = useTrainingCalendar();
  const { today } = data;
  const plan = planForToday(data.todayWorkouts, today);
  const partner = (w: Workout) => partnerNameFor(w, data.jointSessions, data.myId);
  const weather = useSessionWeather(plan.hero ?? null, today);

  let body;
  if (data.isLoading) body = <SessionSkeleton />;
  else if (data.error) body = <ErrorNotice message={errorMessage(data.error)} onRetry={() => void data.refresh()} />;
  else if (plan.hero) {
    const hero = plan.hero;
    body = (
      <TodaySession
        workout={hero}
        partnerName={partner(hero)}
        inCalendar={calendar.enabled && calendar.syncedWorkoutIds.includes(hero.id)}
        onOpen={() => router.push(`/workout/${hero.id}`)}
        onMore={() => onMore(hero)}
        busy={busy}
        weather={weather}
      />
    );
  } else {
    const kind = !data.todayWorkouts.length ? 'free' : plan.isRestDay ? 'rest' :
      data.todayWorkouts.some((w) => w.status === 'skipped') ? 'skipped' : 'finished';
    body = <DayStatusCard kind={kind} today={today} />;
  }

  const showOthers = !data.isLoading && !data.error && plan.others.length > 0;
  return (
    <View style={styles.root}>
      {body}
      {showOthers ? (
        <Disclosure title={plan.hero ? 'También hoy' : 'Sesiones de hoy'} summary={plan.others.map((w) => w.title).join(' · ')} icon="week">
          {plan.others.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              compact
              today={today}
              partnerName={partner(w)}
              thresholds={data.thresholds}
              raceDistance={data.raceDistance}
              onPress={() => router.push(`/workout/${w.id}`)}
            />
          ))}
        </Disclosure>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  skeleton: { gap: space.md },
});
