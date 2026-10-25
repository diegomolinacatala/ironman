import { router } from 'expo-router';

import { addDays, formatDayLabel, todayISO } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import {
  useCreateWorkout,
  useDeleteWorkout,
  useResetWorkout,
  useSkipWorkout,
  useUpdateWorkout,
} from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { confirmAsync, notify } from './confirm';
import { jointNewHref, workoutToDraft } from './draft';

export interface WorkoutActions {
  moveTo: (w: Workout, date: ISODate) => Promise<boolean>;
  moveToTomorrow: (w: Workout) => Promise<boolean>;
  duplicate: (w: Workout, date?: ISODate) => Promise<Workout | null>;
  remove: (w: Workout) => Promise<boolean>;
  skip: (w: Workout) => Promise<boolean>;
  reset: (w: Workout) => Promise<boolean>;
  invite: (w: Workout) => void;
  busy: boolean;
}

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`${label} failed`, error);
    notify(`No se pudo ${label}`, errorMessage(error));
    return null;
  }
}

function jointWarning(w: Workout): Promise<boolean> {
  if (!w.jointSessionId) return Promise.resolve(true);
  return confirmAsync({
    title: 'Es una quedada',
    message: 'Este entreno está vinculado a una sesión con amigos. Si lo cambias, avísales desde la quedada.',
    confirmLabel: 'Continuar',
  });
}

/** Shared mutations for workout cards (Semana long-press, detail, Hoy). */
export function useWorkoutActions(): WorkoutActions {
  const update = useUpdateWorkout();
  const create = useCreateWorkout();
  const del = useDeleteWorkout();
  const skipM = useSkipWorkout();
  const resetM = useResetWorkout();

  const moveTo = async (w: Workout, date: ISODate) => {
    if (!(await jointWarning(w))) return false;
    const ok = await run('mover el entreno', () => update.mutateAsync({ id: w.id, patch: { date } }));
    if (ok) haptics.success();
    return ok != null;
  };

  const duplicate = async (w: Workout, date?: ISODate) => {
    const created = await run('duplicar el entreno', () => create.mutateAsync(workoutToDraft(w, date ? { date } : {})));
    if (created) haptics.success();
    return created;
  };

  const remove = async (w: Workout) => {
    const confirmed = await confirmAsync({
      title: '¿Borrar entreno?',
      message: w.jointSessionId
        ? `«${w.title}» es parte de una quedada. Se quitará de tu calendario.`
        : `«${w.title}» · ${formatDayLabel(w.date, todayISO())}`,
      confirmLabel: 'Borrar',
      destructive: true,
    });
    if (!confirmed) return false;
    const ok = await run('borrar el entreno', async () => {
      await del.mutateAsync(w.id);
      return true;
    });
    return ok === true;
  };

  const skip = async (w: Workout) => {
    const confirmed = await confirmAsync({
      title: '¿Saltar este entreno?',
      message: 'Quedará marcado como saltado. Puedes reabrirlo cuando quieras.',
      confirmLabel: 'Saltar',
    });
    if (!confirmed) return false;
    const ok = await run('saltar el entreno', () => skipM.mutateAsync({ id: w.id }));
    return ok != null;
  };

  const reset = async (w: Workout) => {
    const ok = await run('reabrir el entreno', () => resetM.mutateAsync(w.id));
    return ok != null;
  };

  return {
    moveTo,
    moveToTomorrow: (w) => moveTo(w, addDays(w.date < todayISO() ? todayISO() : w.date, 1)),
    duplicate,
    remove,
    skip,
    reset,
    invite: (w) => router.push(jointNewHref(w)),
    busy: update.isPending || create.isPending || del.isPending || skipM.isPending || resetM.isPending,
  };
}
