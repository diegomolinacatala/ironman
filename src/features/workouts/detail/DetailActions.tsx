import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Workout } from '@/domain/types';
import { Button, space } from '@/ui';

import { useActionSheet, type SheetAction } from '../actionSheet';
import { leaveTo } from '../ModalClose';
import type { WorkoutActions } from '../useWorkoutActions';

interface DetailActionsProps {
  workout: Workout;
  actions: WorkoutActions;
  onComplete: () => void;
  onMove: () => void;
}

export function DetailActions({ workout, actions, onComplete, onMove }: DetailActionsProps) {
  const sheet = useActionSheet();
  const planned = workout.status === 'planned';
  const canComplete = planned && workout.sport !== 'rest';

  const openOptions = () => {
    const options: SheetAction[] = [
      { label: 'Editar', icon: 'edit', onPress: () => router.push(`/workout/edit?id=${workout.id}`) },
    ];
    if (planned) options.push({ label: 'Mover', icon: 'move', onPress: onMove });
    if (canComplete) options.push({ label: 'Saltar', icon: 'skip', onPress: () => void actions.skip(workout) });
    if (!planned) options.push({ label: 'Reabrir entreno', icon: 'undo', onPress: () => void actions.reset(workout) });
    if (canComplete && !workout.jointSessionId) {
      options.push({ label: 'Invitar a un amigo', icon: 'together', onPress: () => actions.invite(workout) });
    }
    options.push(
      {
        label: 'Duplicar', icon: 'copy', onPress: async () => {
          const copy = await actions.duplicate(workout);
          if (copy) router.push(`/workout/${copy.id}`);
        },
      },
      {
        label: 'Borrar', icon: 'trash', destructive: true, onPress: async () => {
          if (await actions.remove(workout)) leaveTo('/today');
        },
      },
    );
    sheet.open({ title: workout.title, actions: options });
  };

  return (
    <View style={styles.row}>
      {canComplete ? (
        <Button label="Registrar entreno" icon="check" onPress={onComplete} disabled={actions.busy} style={styles.primary} />
      ) : null}
      <Button label="Opciones" variant="secondary" onPress={openOptions} disabled={actions.busy} accessibilityHint="Gestiona este entreno" />
      {sheet.element}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  primary: { flexGrow: 1 },
});
