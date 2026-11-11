import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import type { CompletedData, RaceDistance, Score5, Workout } from '@/domain/types';
import { formatRpe, sessionRpe } from '@/domain/zones';
import { useCompleteWorkout } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Chip, ErrorNotice, Stepper, Text, TextField, haptics, space } from '@/ui';

import { distanceUnit, formatDistanceInput, parseDistanceInput } from './draft';
import { FEEL_OPTIONS, feelLabel } from './feel';
import { FormLabel } from './FormLabel';
import { RPE_VALUES, rpeLabel, type Rpe } from './rpe';
import { SheetModal } from './SheetModal';

export interface CompleteSheetProps {
  workout: Workout;
  visible: boolean;
  onClose: () => void;
  onDone?: (workout: Workout) => void;
  /** Target race distance: decides the planned RPE of race-pace sessions. */
  raceDistance?: RaceDistance | null;
}

const MAX_DURATION_MIN = 12 * 60;

function hasDistance(workout: Workout): boolean {
  return workout.sport !== 'strength' && workout.sport !== 'mobility' && workout.sport !== 'rest';
}

/** Quick "Hecho" form: real duration, distance, RPE vs the planned one, sensaciones and notes. */
export function CompleteSheet({ workout, visible, onClose, onDone, raceDistance = null }: CompleteSheetProps) {
  const complete = useCompleteWorkout();
  const [durationMin, setDurationMin] = useState(workout.completed?.durationMin ?? workout.durationMin);
  const [distance, setDistance] = useState(formatDistanceInput(workout.completed?.distanceM ?? workout.distanceM, workout.sport));
  const [rpe, setRpe] = useState<Rpe | null>(null);
  const [feel, setFeel] = useState<Score5 | null>(workout.completed?.feel ?? null);
  const [notes, setNotes] = useState('');
  const unit = distanceUnit(workout.sport);
  const plannedRpe = workout.sport === 'rest' ? null : formatRpe(sessionRpe(workout, { raceDistance }));

  const submit = async () => {
    const distanceM = parseDistanceInput(distance, workout.sport);
    const data: CompletedData = {
      durationMin,
      ...(distanceM != null ? { distanceM } : {}),
      ...(rpe != null ? { rpe } : {}),
      ...(feel != null ? { feel } : {}),
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
      {hasDistance(workout) ? (
        <TextField
          label={`Distancia (${unit})`}
          value={distance}
          onChangeText={setDistance}
          keyboardType="decimal-pad"
          placeholder={unit === 'm' ? '2500' : '10,5'}
          accessibilityLabel={`Distancia en ${unit === 'm' ? 'metros' : 'kilómetros'}`}
        />
      ) : null}
      <RpePicker value={rpe} onChange={setRpe} planned={plannedRpe} />
      <FeelPicker value={feel} onChange={setFeel} />
      <TextField label="Notas" value={notes} onChangeText={setNotes} multiline placeholder="Molestias, clima, cómo has comido…" />
    </SheetModal>
  );
}

export interface RpePickerProps {
  value: Rpe | null;
  onChange: (rpe: Rpe) => void;
  /** Planned RPE of the session ("RPE 7–8"), shown next to the label. */
  planned?: string | null;
}

export function RpePicker({ value, onChange, planned }: RpePickerProps) {
  return (
    <View style={styles.block}>
      <View style={styles.labelRow}>
        <FormLabel>Esfuerzo percibido (RPE)</FormLabel>
        {planned ? (
          <Text variant="caption" color="textMuted" style={styles.tabular}>
            {`Previsto: ${planned}`}
          </Text>
        ) : null}
      </View>
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

/** "Sensaciones" 1–5 (Muy mal … Genial), saved as `completed.feel`. */
export function FeelPicker({ value, onChange }: { value: Score5 | null; onChange: (feel: Score5) => void }) {
  return (
    <View style={styles.block}>
      <FormLabel>Sensaciones</FormLabel>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Sensaciones, de muy mal a genial">
        {FEEL_OPTIONS.map((option) => (
          <Chip key={option.value} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />
        ))}
      </View>
      <Text variant="caption" color="textMuted">
        {value != null ? `Te has sentido: ${feelLabel(value).toLowerCase()}` : 'Cómo te has notado, más allá del esfuerzo.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tabular: { fontVariant: ['tabular-nums'] },
});
