import type { ReactNode } from 'react';

import type { Workout } from '@/domain/types';
import { useActionSheet, type SheetAction } from '@/features/workouts/actionSheet';
import { useWorkoutActions } from '@/features/workouts/useWorkoutActions';

type WorkoutActions = ReturnType<typeof useWorkoutActions>;

/** Long-press menu of a session in the week: move, duplicate, invite, delete. */
export function workoutMenuActions(w: Workout, actions: WorkoutActions): SheetAction[] {
  return [
    ...(w.status === 'planned' ? [{ label: 'Mover a mañana', icon: 'move' as const, onPress: () => void actions.moveToTomorrow(w) }] : []),
    { label: 'Duplicar', icon: 'copy', onPress: () => void actions.duplicate(w) },
    ...(w.status === 'planned' && !w.jointSessionId && w.sport !== 'rest'
      ? [{ label: 'Invitar a un amigo', icon: 'together' as const, onPress: () => actions.invite(w) }]
      : []),
    { label: 'Borrar', icon: 'trash', destructive: true, onPress: () => void actions.remove(w) },
  ];
}

export function useWorkoutMenu(): { open: (w: Workout) => void; element: ReactNode } {
  const actions = useWorkoutActions();
  const sheet = useActionSheet();
  return {
    open: (w) => sheet.open({ title: w.title, actions: workoutMenuActions(w, actions) }),
    element: sheet.element,
  };
}
