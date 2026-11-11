import { StyleSheet, View } from 'react-native';

import { stepLines } from '@/domain/prescription';
import type { Intensity, RaceDistance, Sport, Thresholds, WorkoutStep } from '@/domain/types';
import { formatStepMinutes, stepIntensity } from '@/domain/zones';
import { Button, Card, Chip, IconButton, Stepper, Text, TextField, space } from '@/ui';

import { STEP_CUE_MAX, addStep, removeStep, setStepCue, updateStep } from './form';
import { FormLabel } from './FormLabel';
import { IntensityPicker } from './pickers';
import { STEP_KINDS, snapStepMinutes, stepKindLabel, stepMinutesIncrement, stepsTotalMinutes } from './steps';
import { stepTargetCaption } from './targets';

export interface StepsEditorProps {
  steps: WorkoutStep[];
  onChange: (steps: WorkoutStep[]) => void;
  intensity: Intensity;
  plannedMin: number;
  /** Sport of the session: targets per step and, for a brick, the leg of each step. */
  sport?: Sport;
  thresholds?: Thresholds | null;
  raceDistance?: RaceDistance | null;
}

const LEGS: readonly { value: 'bike' | 'run'; label: string }[] = [
  { value: 'bike', label: 'Bici' },
  { value: 'run', label: 'Carrera' },
];

function totalLabel(total: number, plannedMin: number): string {
  return `Suma ${formatStepMinutes(total) || "0'"} de ${formatStepMinutes(plannedMin) || "0'"}`;
}

/** Editable list of structured steps (kind, minutes or metres, repeats, intensity, brick leg and cue). */
export function StepsEditor({ steps, onChange, intensity, plannedMin, sport = 'run', thresholds = null, raceDistance = null }: StepsEditorProps) {
  const total = stepsTotalMinutes(steps);
  const lines = stepLines({ sport, intensity, steps }, thresholds, { raceDistance });
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <FormLabel>Estructura</FormLabel>
        {total != null ? (
          <Text variant="caption" color={total === plannedMin ? 'textMuted' : 'warning'} style={styles.tabular}>
            {totalLabel(total, plannedMin)}
          </Text>
        ) : null}
      </View>
      {steps.map((step, index) => {
        const line = lines[index];
        return (
          <StepRow
            key={`step-${index}`}
            index={index}
            step={step}
            workoutIntensity={intensity}
            brick={sport === 'brick'}
            target={line ? stepTargetCaption(line) : ''}
            onChange={(patch) => onChange(updateStep(steps, index, patch))}
            onCue={(text) => onChange(setStepCue(steps, index, text))}
            onRemove={() => onChange(removeStep(steps, index))}
          />
        );
      })}
      <Button label="Añadir paso" icon="add" variant="secondary" size="sm" onPress={() => onChange(addStep(steps, intensity))} />
    </View>
  );
}

interface StepRowProps {
  index: number;
  step: WorkoutStep;
  workoutIntensity: Intensity;
  brick: boolean;
  /** "Z4 · 162–168 ppm · RPE 7–8" with the athlete's zones. */
  target: string;
  onChange: (patch: Partial<WorkoutStep>) => void;
  onCue: (text: string) => void;
  onRemove: () => void;
}

function StepRow({ index, step, workoutIntensity, brick, target, onChange, onCue, onRemove }: StepRowProps) {
  const n = index + 1;
  return (
    <Card variant="tinted" padding="md" style={styles.card}>
      <View style={styles.header}>
        <Text variant="heading">{`Paso ${n}`}</Text>
        <IconButton icon="trash" accessibilityLabel={`Quitar paso ${n}`} onPress={onRemove} size={36} />
      </View>
      <View style={styles.wrap}>
        {STEP_KINDS.map((kind) => (
          <Chip key={kind} label={stepKindLabel(kind)} selected={step.kind === kind} onPress={() => onChange({ kind })} />
        ))}
      </View>
      {brick ? (
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={`Tramo del paso ${n}`}>
          {LEGS.map((leg) => (
            <Chip key={leg.value} label={leg.label} selected={(step.leg ?? 'bike') === leg.value} onPress={() => onChange({ leg: leg.value })} />
          ))}
        </View>
      ) : null}
      <StepAmounts step={step} onChange={onChange} />
      <IntensityPicker value={stepIntensity(step, workoutIntensity)} onChange={(i) => onChange({ intensity: i })} />
      {target ? (
        <Text variant="caption" color="textMuted" style={styles.tabular}>
          {target}
        </Text>
      ) : null}
      <TextField
        label="Sensaciones o técnica"
        accessibilityLabel={`Sensaciones o técnica del paso ${n}`}
        value={step.cue ?? ''}
        onChangeText={onCue}
        placeholder="p. ej. Respiración cómoda: puedes hablar en frases"
        maxLength={STEP_CUE_MAX}
      />
    </Card>
  );
}

function StepAmounts({ step, onChange }: { step: WorkoutStep; onChange: (patch: Partial<WorkoutStep>) => void }) {
  const byDistance = step.durationMin == null && step.distanceM != null;
  const minutes = step.durationMin ?? 10;
  return (
    <View style={styles.steppers}>
      <View style={styles.flex}>
        {byDistance ? (
          <Stepper label="Metros" value={step.distanceM ?? 100} onChange={(distanceM) => onChange({ distanceM })} step={50} min={25} max={10000} />
        ) : (
          <Stepper
            label="Duración"
            value={minutes}
            onChange={(d) => onChange({ durationMin: snapStepMinutes(d) })}
            step={stepMinutesIncrement(minutes)}
            min={0.5}
            max={360}
            format={formatStepMinutes}
          />
        )}
      </View>
      <View style={styles.flex}>
        <Stepper
          label="Repeticiones"
          value={step.repeat ?? 1}
          onChange={(repeat) => onChange({ repeat: repeat > 1 ? repeat : undefined })}
          step={1}
          min={1}
          max={40}
          format={(r) => `${r}×`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  card: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  steppers: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});
