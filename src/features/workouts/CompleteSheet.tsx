import { router } from 'expo-router';
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
  /** "Analizar sesión" after saving; default: open the workout and start the analysis there. */
  onAnalyze?: (workout: Workout) => void;
}

const MAX_DURATION_MIN = 12 * 60;

function hasDistance(workout: Workout): boolean {
  return workout.sport !== 'strength' && workout.sport !== 'mobility' && workout.sport !== 'rest';
}

/** Quick "Hecho" form: real duration, distance, RPE vs the planned one, sensaciones and notes. */
export function CompleteSheet({ workout, visible, onClose, onDone, raceDistance = null, onAnalyze }: CompleteSheetProps) {
  const complete = useCompleteWorkout();
  const [durationMin, setDurationMin] = useState(workout.completed?.durationMin ?? workout.durationMin);
  const [distance, setDistance] = useState(formatDistanceInput(workout.completed?.distanceM ?? workout.distanceM, workout.sport));
  const [rpe, setRpe] = useState<Rpe | null>(null);
  const [feel, setFeel] = useState<Score5 | null>(workout.completed?.feel ?? null);
  const [notes, setNotes] = useState('');
  // Once saved, the sheet offers the analysis instead of closing at once.
  const [saved, setSaved] = useState<Workout | null>(null);
  const unit = distanceUnit(workout.sport);
  const plannedRange = workout.sport === 'rest' ? null : sessionRpe(workout, { raceDistance });
  const plannedRpe = plannedRange ? formatRpe(plannedRange) : null;

  /** "Tal como estaba previsto": planned duration and distance and the middle of the planned RPE, in one tap. */
  const fillAsPlanned = () => {
    setDurationMin(workout.durationMin);
    setDistance(formatDistanceInput(workout.distanceM, workout.sport));
    if (plannedRange) setRpe(asPlannedRpe(plannedRange.min, plannedRange.max));
  };

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
      // Without connection it is kept on the phone and resolves as done (a notice says it will be sent).
      const done = await complete.mutateAsync({ id: workout.id, data, workout });
      haptics.success();
      onDone?.(done);
      setSaved(done);
    } catch (error) {
      logger.warn('complete workout failed', error);
    }
  };

  if (saved) return <AnalyzeOffer workout={saved} visible={visible} onClose={onClose} onAnalyze={onAnalyze ?? openAnalysis} />;

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      overline={workout.title}
      title="¿Qué tal ha ido?"
      footer={
        <View style={styles.footer}>
          {complete.error ? <ErrorNotice message={errorMessage(complete.error)} /> : null}
          <Button label="Guardar como hecho" icon="check" onPress={() => void submit()} loading={complete.isPending} fullWidth size="lg" />
        </View>
      }>
      {workout.sport !== 'rest' ? (
        <View style={styles.quick}>
          <Chip label="Tal como estaba previsto" icon="check" onPress={fillAsPlanned} />
        </View>
      ) : null}
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

/** After "Guardar como hecho": the option to analyse the session right away. */
function openAnalysis(workout: Workout): void {
  router.push(`/workout/${workout.id}?analyze=1`);
}

interface AnalyzeOfferProps {
  workout: Workout;
  visible: boolean;
  onClose: () => void;
  onAnalyze: (workout: Workout) => void;
}

function AnalyzeOffer({ workout, visible, onClose, onAnalyze }: AnalyzeOfferProps) {
  const analyze = () => {
    onClose();
    onAnalyze(workout);
  };
  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      overline={workout.title}
      title="¡Sesión hecha!"
      footer={
        <View style={styles.block}>
          <Button label="Analizar sesión" icon="sparkles" onPress={analyze} fullWidth size="lg" />
          <Button label="Ahora no" variant="ghost" onPress={onClose} fullWidth />
        </View>
      }>
      <Text variant="body">
        Tu coach compara lo que has hecho con el plan, tu check-in de hoy y la carga de la semana, y te dice qué ajustar y qué toca mañana.
      </Text>
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

/** Middle of the planned RPE range, rounded down (an honest "as planned"), as a 1-10 pick. */
export function asPlannedRpe(min: number, max: number): Rpe {
  const mid = Math.floor((min + max) / 2);
  return Math.min(10, Math.max(1, mid)) as Rpe;
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  quick: { flexDirection: 'row' },
  block: { gap: space.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tabular: { fontVariant: ['tabular-nums'] },
});
