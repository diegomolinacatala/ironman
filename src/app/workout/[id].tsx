import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { complianceOf } from '@/domain/load';
import type { ISODate, Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import { useJointSession, useWorkout } from '@/data/queries';
import { easierPatch, workoutVerdict } from '@/features/workouts/coachAdapters';
import { CompleteSheet } from '@/features/workouts/CompleteSheet';
import { CoachVerdict } from '@/features/workouts/detail/CoachVerdict';
import { CompletedPanel } from '@/features/workouts/detail/CompletedPanel';
import { DetailActions } from '@/features/workouts/detail/DetailActions';
import { JointInfo } from '@/features/workouts/detail/JointInfo';
import { PlanSections } from '@/features/workouts/detail/PlanSections';
import { WorkoutHeader } from '@/features/workouts/detail/WorkoutSummary';
import { partnerNames } from '@/features/workouts/draft';
import { FuelingHint } from '@/features/workouts/FuelingHint';
import { leaveTo } from '@/features/workouts/ModalClose';
import { MoveSheet } from '@/features/workouts/MoveSheet';
import { useAthleteTargets } from '@/features/workouts/useAthleteTargets';
import { useWorkoutActions, type WorkoutActions } from '@/features/workouts/useWorkoutActions';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen } from '@/ui';

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
  const athlete = useAthleteTargets();
  const [completing, setCompleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const names = partnerNames(joint.data ?? undefined, myId);
  const partnerName = names.length > 0 ? names.join(' y ') : null;
  const compliance = complianceOf(workout, today);
  // Plan B is for a session still ahead (today or later), never for one already missed.
  const upcoming = workout.status === 'planned' && workout.date >= today;
  const easier = upcoming ? easierPatch(workout, athlete.thresholds) : null;

  return (
    <Screen inSheet onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: sportLabel(workout.sport) }} />
      <WorkoutHeader workout={workout} partnerName={partnerName} />
      <CompletedPanel workout={workout} compliance={compliance} thresholds={athlete.thresholds} raceDistance={athlete.raceDistance} />
      <CoachVerdict verdict={workoutVerdict(workout, athlete.thresholds, athlete.raceDistance)} />
      <PlanSections
        workout={workout}
        athlete={athlete}
        upcoming={upcoming}
        onEase={easier ? () => void actions.easier(workout, easier) : null}
        busy={actions.busy}
      />
      {workout.jointSessionId ? <JointInfo sessionId={workout.jointSessionId} myId={myId} /> : null}
      {workout.sport !== 'rest' && workout.durationMin >= 45 ? <FuelingHint workout={workout} /> : null}
      <DetailActions workout={workout} actions={actions} onComplete={() => setCompleting(true)} onMove={() => setMoving(true)} />
      {completing ? (
        <CompleteSheet key={workout.id} workout={workout} raceDistance={athlete.raceDistance} visible onClose={() => setCompleting(false)} />
      ) : null}
      <DetailMoveSheet workout={workout} today={today} actions={actions} visible={moving} onClose={() => setMoving(false)} />
    </Screen>
  );
}

interface DetailMoveSheetProps {
  workout: Workout;
  today: ISODate;
  actions: WorkoutActions;
  visible: boolean;
  onClose: () => void;
}

/** "Mover": closes only once the move is saved. */
function DetailMoveSheet({ workout, today, actions, visible, onClose }: DetailMoveSheetProps) {
  return (
    <MoveSheet
      visible={visible}
      onClose={onClose}
      fromDate={workout.date}
      today={today}
      busy={actions.busy}
      onSelect={(date) => {
        void actions.moveTo(workout, date).then((ok) => {
          if (ok) onClose();
        });
      }}
    />
  );
}
