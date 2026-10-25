import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { formatDuration, todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { Workout } from '@/domain/types';
import { firstError, workoutDraftSchema } from '@/domain/validation';
import { useCreateWorkout, useUpdateWorkout, useWorkout } from '@/data/queries';
import { emptyForm, formToDraft, isSport, shouldResetTss, workoutToForm, type WorkoutFormState } from '@/features/workouts/form';
import { FormFooter } from '@/features/workouts/FormFooter';
import { FormScreen } from '@/features/workouts/FormScreen';
import { ModalCancel, closeModal } from '@/features/workouts/ModalClose';
import { WorkoutForm } from '@/features/workouts/WorkoutForm';
import { errorMessage, logger } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, haptics } from '@/ui';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export default function WorkoutEditScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string; sport?: string }>();
  const id = param(params.id);
  const workout = useWorkout(id);

  if (id && workout.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando entreno" />
      </Screen>
    );
  }
  if (id && workout.error) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <ErrorNotice message={errorMessage(workout.error)} onRetry={() => void workout.refetch()} />
      </Screen>
    );
  }
  if (id && !workout.data) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <EmptyState
          icon="info"
          title="No encontramos este entreno"
          message="Puede que se haya borrado."
          action={<Button label="Cerrar" variant="secondary" onPress={closeModal} />}
        />
      </Screen>
    );
  }

  const date = param(params.date);
  const sport = param(params.sport);
  const initial = workout.data
    ? workoutToForm(workout.data)
    : emptyForm(date && DATE_RE.test(date) ? date : todayISO(), isSport(sport) ? sport : 'run');
  return <Editor key={workout.data?.id ?? 'new'} initial={initial} existing={workout.data ?? null} />;
}

function Editor({ initial, existing }: { initial: WorkoutFormState; existing: Workout | null }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateWorkout();
  const update = useUpdateWorkout();
  const saving = create.isPending || update.isPending;

  const save = async () => {
    const withTitle = state.title.trim()
      ? state
      : { ...state, title: state.sport === 'rest' ? 'Descanso' : `${sportLabel(state.sport)} ${formatDuration(state.durationMin)}` };
    const draft = formToDraft(withTitle, existing ? undefined : 'manual');
    const result = workoutDraftSchema.safeParse(draft);
    if (!result.success) {
      haptics.warning();
      setError(firstError(result) ?? 'Revisa los datos del entreno.');
      return;
    }
    setError(null);
    try {
      if (existing) {
        const patch = shouldResetTss(existing, draft) ? { ...draft, tss: null } : draft;
        await update.mutateAsync({ id: existing.id, patch });
      } else {
        await create.mutateAsync(draft);
      }
      haptics.success();
      closeModal();
    } catch (e) {
      logger.warn('save workout failed', e);
      haptics.warning();
      setError(errorMessage(e, 'No se ha podido guardar el entreno.'));
    }
  };

  const change = (next: WorkoutFormState) => {
    setError(null);
    setState(next);
  };

  const footer = (
    <FormFooter errors={[error]}>
      <Button label={existing ? 'Guardar cambios' : 'Añadir entreno'} icon="check" onPress={() => void save()} loading={saving} fullWidth size="lg" />
    </FormFooter>
  );

  return (
    <FormScreen inSheet footer={footer}>
      <Stack.Screen options={{ title: existing ? 'Editar entreno' : 'Nuevo entreno', headerLeft: () => <ModalCancel /> }} />
      <WorkoutForm state={state} onChange={change} titleError={null} />
    </FormScreen>
  );
}
