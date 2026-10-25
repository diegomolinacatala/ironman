import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Workout } from '@/domain/types';
import { Button, Card, Divider, ListRow, space } from '@/ui';

import { leaveTo } from '../ModalClose';
import type { WorkoutActions } from '../useWorkoutActions';

export interface DetailActionsProps {
  workout: Workout;
  actions: WorkoutActions;
  onComplete: () => void;
  onMove: () => void;
}

/** Primary actions (Hecho / Saltar / Mover or Reabrir) + secondary list. */
export function DetailActions({ workout, actions, onComplete, onMove }: DetailActionsProps) {
  const isPlanned = workout.status === 'planned';
  const isRest = workout.sport === 'rest';
  return (
    <View style={styles.root}>
      {isPlanned && !isRest ? (
        <>
          <Button label="Hecho" icon="check" onPress={onComplete} size="lg" fullWidth />
          <View style={styles.row}>
            <Button label="Saltar" icon="skip" variant="secondary" onPress={() => void actions.skip(workout)} style={styles.flex} />
            <Button label="Mover" icon="move" variant="secondary" onPress={onMove} style={styles.flex} />
          </View>
        </>
      ) : null}
      {!isPlanned ? (
        <Button label="Reabrir entreno" icon="undo" variant="secondary" onPress={() => void actions.reset(workout)} fullWidth loading={actions.busy} />
      ) : null}
      <Card padding="sm">
        <ListRow title="Editar" icon="edit" onPress={() => router.push(`/workout/edit?id=${workout.id}`)} />
        <Divider inset={46} />
        {isPlanned && isRest ? (
          <>
            <ListRow title="Mover" icon="move" onPress={onMove} />
            <Divider inset={46} />
          </>
        ) : null}
        <ListRow
          title="Duplicar"
          subtitle="Crea una copia el mismo día"
          icon="copy"
          onPress={() => {
            void actions.duplicate(workout).then((copy) => {
              if (copy) router.push(`/workout/${copy.id}`);
            });
          }}
        />
        {isPlanned && !isRest && !workout.jointSessionId ? (
          <>
            <Divider inset={46} />
            <ListRow title="Invitar a un amigo" subtitle="Proponer una quedada" icon="together" onPress={() => actions.invite(workout)} />
          </>
        ) : null}
        <Divider inset={46} />
        <ListRow
          title="Borrar"
          icon="trash"
          destructive
          onPress={() => {
            void actions.remove(workout).then((deleted) => {
              // Opened from a widget there may be no back stack: fall back to Hoy instead of staying on "no encontrado".
              if (deleted) leaveTo('/today');
            });
          }}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
});
