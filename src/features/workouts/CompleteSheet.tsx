import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import type { CompletedData, Workout } from '@/domain/types';
import { useCompleteWorkout } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Chip, ErrorNotice, Stepper, Text, TextField, haptics, space } from '@/ui';

import { distanceUnit, formatDistanceInput, parseDistanceInput } from './draft';
import { RPE_VALUES, rpeLabel, type Rpe } from './rpe';
import { SheetModal } from './SheetModal';

export interface CompleteSheetProps {
  workout: Workout;
  visible: boolean;
  onClose: () => void;
  onDone?: (workout: Workout) => void;
}

const MAX_DURATION_MIN = 12 * 60;

/** Quick "✓ Hecho" form: real duration, distance, RPE and notes. */
export function CompleteSheet({ workout, visible, onClose, onDone }: CompleteSheetProps) {
  const complete = useCompleteWorkout();
  const [durationMin, setDurationMin] = useState(workout.completed?.durationMin ?? workout.durationMin);
  const [distance, setDistance] = useState(formatDistanceInput(workout.completed?.distanceM ?? workout.distanceM, workout.sport));
  const [rpe, setRpe] = useState<Rpe | null>(null);
  const [notes, setNotes] = useState('');
  const unit = distanceUnit(workout.sport);

  const submit = async () => {
    const distanceM = parseDistanceInput(distance, workout.sport);
    const data: CompletedData = {
      durationMin,
      ...(distanceM != null ? { distanceM } : {}),
      ...(rpe != null ? { rpe } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      source: 'manual',
      completedAt: new Date().toISOString(),
    };
    try {
      const done = await complete.mutateAsync({ id: workout.id, data });
      haptics.success();
      onDone?.(done);
      onClose();
    } catch (error) {
      logger.warn('complete workout failed', error);
    }
  };

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      overline={workout.title}
      title="¿Qué tal ha ido?"
      footer={
        <Button label="Guardar como hecho" icon="check" onPress={() => void submit()} loading={complete.isPending} fullWidth size="lg" />
      }>
      {complete.error ? <ErrorNotice message={errorMessage(complete.error)} /> : null}
      <Stepper
        label={`Duración real · plan ${formatDuration(workout.durationMin)}`}
        value={durationMin}
        onChange={setDurationMin}
        step={5}
        min={0}
        max={MAX_DURATION_MIN}
        format={formatDuration}
      />
      {workout.sport !== 'strength' && workout.sport !== 'mobility' && workout.sport !== 'rest' ? (
        <TextField
          label={`Distancia (${unit})`}
          value={distance}
          onChangeText={setDistance}
          keyboardType="decimal-pad"
          placeholder={unit === 'm' ? '2500' : '10,5'}
          accessibilityLabel={`Distancia en ${unit === 'm' ? 'metros' : 'kilómetros'}`}
        />
      ) : null}
      <RpePicker value={rpe} onChange={setRpe} />
      <TextField label="Notas" value={notes} onChangeText={setNotes} multiline placeholder="Sensaciones, molestias, clima…" />
    </SheetModal>
  );
}

export function RpePicker({ value, onChange }: { value: Rpe | null; onChange: (rpe: Rpe) => void }) {
  return (
    <View style={styles.block}>
      <Text variant="overline" color="textMuted">
        Esfuerzo percibido (RPE)
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Esfuerzo percibido del 1 al 10">
        {RPE_VALUES.map((n) => (
          <Chip key={n} label={String(n)} selected={value === n} onPress={() => onChange(n)} />
        ))}
      </View>
      <Text variant="caption" color="textMuted">
        {value != null ? `${value}/10 · ${rpeLabel(value)}` : '1 = paseo · 10 = al límite'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
