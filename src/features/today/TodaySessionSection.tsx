import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Workout } from '@/domain/types';
import { Skeleton } from '@/features/briefing/Skeleton';
import { partnerNameFor } from '@/features/workouts/draft';
import { WorkoutCard } from '@/features/workouts/WorkoutCard';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage } from '@/lib/logger';
import { Card, ErrorNotice, SectionHeader, radius, space } from '@/ui';

import { DayStatusCard } from './DayStatusCard';
import { planForToday } from './selectors';
import { TodaySession } from './TodaySession';
import type { TodayData } from './useTodayData';

export interface TodaySessionSectionProps {
  data: TodayData;
  busy: boolean;
  onComplete: (workout: Workout) => void;
  onMore: (workout: Workout) => void;
}

function SessionSkeleton() {
  return (
    <Card padding="lg" style={styles.skeleton}>
      <Skeleton width="40%" height={12} />
      <Skeleton width="35%" height={40} radius={radius.md} />
      <Skeleton width="80%" height={18} />
      <Skeleton height={48} radius={radius.pill} />
    </Card>
  );
}

/** "Tu entreno de hoy": next session, rest / done states and the rest of today's sessions. */
export function TodaySessionSection({ data, busy, onComplete, onMore }: TodaySessionSectionProps) {
  const calendar = useTrainingCalendar();
  const { today } = data;
  const plan = planForToday(data.todayWorkouts, today);
  const partner = (w: Workout) => partnerNameFor(w, data.jointSessions, data.myId);

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
        onComplete={() => onComplete(hero)}
        onMore={() => onMore(hero)}
        busy={busy}
      />
    );
  } else body = <DayStatusCard kind={plan.isRestDay ? 'rest' : 'done'} today={today} />;

  const showOthers = !data.isLoading && !data.error && plan.others.length > 0;
  return (
    <View style={styles.root}>
      <SectionHeader title="Tu entreno de hoy" />
      {body}
      {showOthers ? (
        <View style={styles.others}>
          <SectionHeader title={plan.hero ? 'También hoy' : 'Sesiones de hoy'} />
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
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  others: { gap: space.sm, marginTop: space.sm },
  skeleton: { gap: space.md },
});
