import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { complianceOf } from '@/domain/load';
import type { Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import { useJointSession, useWorkout } from '@/data/queries';
import { CompleteSheet } from '@/features/workouts/CompleteSheet';
import { CompletedPanel } from '@/features/workouts/detail/CompletedPanel';
import { DetailActions } from '@/features/workouts/detail/DetailActions';
import { JointInfo } from '@/features/workouts/detail/JointInfo';
import { WorkoutHeader, WorkoutMetrics } from '@/features/workouts/detail/WorkoutSummary';
import { partnerNames } from '@/features/workouts/draft';
import { FuelingHint } from '@/features/workouts/FuelingHint';
import { leaveTo } from '@/features/workouts/ModalClose';
import { MoveSheet } from '@/features/workouts/MoveSheet';
import { StepsBar } from '@/features/workouts/StepsBar';
import { useWorkoutActions } from '@/features/workouts/useWorkoutActions';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, SectionHeader, Stack as UIStack, Text } from '@/ui';

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = typeof id === 'string' ? id : undefined;
  const auth = useAuth();
  const workout = useWorkout(workoutId);

  // A cold-start deep link (widget) lands here before the session is restored: wait instead of flashing "no encontrado".
  if (auth.isLoading || workout.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando entreno" />
      </Screen>
    );
  }
  if (workout.error && !workout.data) {
    return (
      <Screen inSheet>
        <ErrorNotice message={errorMessage(workout.error)} onRetry={() => void workout.refetch()} />
      </Screen>
    );
  }
  // Signed out (e.g. a stale widget link): let the entry gate decide where to go.
  if (!auth.session) return <Redirect href="/" />;
  if (!workout.data) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ title: 'Entreno' }} />
        <EmptyState
          icon="info"
          title="Entreno no encontrado"
          message="Puede que se haya borrado o movido."
          action={<Button label="Volver" icon="chevronLeft" variant="secondary" onPress={() => leaveTo('/today')} />}
        />
      </Screen>
    );
  }
  return <WorkoutDetail workout={workout.data} onRefresh={() => void workout.refetch()} refreshing={workout.isRefetching} />;
}

function WorkoutDetail({ workout, onRefresh, refreshing }: { workout: Workout; onRefresh: () => void; refreshing: boolean }) {
  const today = todayISO();
  const { session } = useAuth();
  const myId = session?.userId;
  const joint = useJointSession(workout.jointSessionId ?? undefined);
  const actions = useWorkoutActions();
  const [completing, setCompleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const names = partnerNames(joint.data ?? undefined, myId);
  const partnerName = names.length > 0 ? names.join(' y ') : null;
  const compliance = complianceOf(workout, today);

  return (
    <Screen inSheet onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: sportLabel(workout.sport) }} />
      <WorkoutHeader workout={workout} partnerName={partnerName} />
      <CompletedPanel workout={workout} compliance={compliance} />
      <WorkoutMetrics workout={workout} />
      {workout.description ? <Text variant="body">{workout.description}</Text> : null}
      {workout.steps.length > 0 ? (
        <UIStack gap="sm">
          <SectionHeader title="Estructura" />
          <StepsBar steps={workout.steps} intensity={workout.intensity} sport={workout.sport} />
        </UIStack>
      ) : null}
      {workout.jointSessionId ? <JointInfo sessionId={workout.jointSessionId} myId={myId} /> : null}
      {workout.sport !== 'rest' && workout.durationMin >= 45 ? <FuelingHint workout={workout} /> : null}
      <DetailActions workout={workout} actions={actions} onComplete={() => setCompleting(true)} onMove={() => setMoving(true)} />
      {completing ? <CompleteSheet key={workout.id} workout={workout} visible onClose={() => setCompleting(false)} /> : null}
      <MoveSheet
        visible={moving}
        onClose={() => setMoving(false)}
        fromDate={workout.date}
        today={today}
        busy={actions.busy}
        onSelect={(date) => {
          void actions.moveTo(workout, date).then((ok) => {
            if (ok) setMoving(false);
          });
        }}
      />
    </Screen>
  );
}
