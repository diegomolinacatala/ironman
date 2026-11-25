import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Thresholds, Workout } from '@/domain/types';
import { toZwo, zwoFileName } from '@/domain/zwo';
import { shareZwo } from '@/integrations/zwift/shareZwo';
import { Button, Card, Divider, ListRow, haptics, space } from '@/ui';

import { leaveTo } from '../ModalClose';
import type { WorkoutActions } from '../useWorkoutActions';

export interface DetailActionsProps {
  workout: Workout;
  actions: WorkoutActions;
  onComplete: () => void;
  onMove: () => void;
  /** For the Zwift export (power as a fraction of FTP). */
  thresholds?: Thresholds | null;
}

/** Divider inset that lines up with `ListRow` text (padding 4 + icon tile 32 + gap 12). */
const LIST_ICON_INSET = 48;

/** Primary actions (Hecho / Saltar / Mover or Reabrir) + secondary list. */
export function DetailActions({ workout, actions, onComplete, onMove, thresholds = null }: DetailActionsProps) {
  const isPlanned = workout.status === 'planned';
  const isRest = workout.sport === 'rest';
  const zwo = isPlanned ? toZwo(workout, thresholds) : null;
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
        <Divider inset={LIST_ICON_INSET} />
        {isPlanned && isRest ? (
          <>
            <ListRow title="Mover" icon="move" onPress={onMove} />
            <Divider inset={LIST_ICON_INSET} />
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
        {zwo ? (
          <>
            <Divider inset={LIST_ICON_INSET} />
            <ListRow
              title="Exportar a Zwift"
              subtitle="Archivo .zwo con tus vatios"
              icon="share"
              onPress={() => {
                haptics.tap();
                void shareZwo(zwoFileName(workout.title), zwo);
              }}
            />
          </>
        ) : null}
        {isPlanned && !isRest && !workout.jointSessionId ? (
          <>
            <Divider inset={LIST_ICON_INSET} />
            <ListRow title="Invitar a un amigo" subtitle="Proponer una quedada" icon="together" onPress={() => actions.invite(workout)} />
          </>
        ) : null}
        <Divider inset={LIST_ICON_INSET} />
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
