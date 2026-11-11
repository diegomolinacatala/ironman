/** "Más opciones" of today's session as an action-sheet config (pure, so Hoy stays small). */
import type { Workout, WorkoutPatch } from '@/domain/types';
import type { ActionSheetConfig, SheetAction } from '@/features/workouts/actionSheet';

export interface MoreSheetHandlers {
  onEasier: (patch: WorkoutPatch) => void;
  onMove: () => void;
  onSkip: () => void;
}

/** "No es mi día" first when the session has an easier version, then "Mover a otro día" and "Saltar". */
export function moreSheetConfig(workout: Pick<Workout, 'title'>, easier: WorkoutPatch | null, handlers: MoreSheetHandlers): ActionSheetConfig {
  const planB: SheetAction[] = easier ? [{ label: 'No es mi día', icon: 'arrowDown', onPress: () => handlers.onEasier(easier) }] : [];
  return {
    title: workout.title,
    ...(easier ? { message: 'Si hoy no te ves, cámbialo por una versión más suave.' } : {}),
    actions: [
      ...planB,
      { label: 'Mover a otro día', icon: 'move', onPress: handlers.onMove },
      { label: 'Saltar', icon: 'skip', onPress: handlers.onSkip },
    ],
  };
}
