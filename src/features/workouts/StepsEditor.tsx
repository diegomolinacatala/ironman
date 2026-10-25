import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import type { Intensity, WorkoutStep } from '@/domain/types';
import { Button, Card, Chip, IconButton, Stepper, Text, space } from '@/ui';

import { addStep, removeStep, updateStep } from './form';
import { IntensityPicker } from './pickers';
import { STEP_KINDS, stepKindLabel, stepsTotalMinutes } from './steps';

export interface StepsEditorProps {
  steps: WorkoutStep[];
  onChange: (steps: WorkoutStep[]) => void;
  intensity: Intensity;
  plannedMin: number;
}

/** Editable list of structured steps (kind, minutes or metres, intensity, repeats). */
export function StepsEditor({ steps, onChange, intensity, plannedMin }: StepsEditorProps) {
  const total = stepsTotalMinutes(steps);
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="overline" color="textMuted">
          Estructura
        </Text>
        {total != null ? (
          <Text variant="caption" color={total === plannedMin ? 'textMuted' : 'warning'}>
            {`Suma ${formatDuration(total)} de ${formatDuration(plannedMin)}`}
          </Text>
        ) : null}
      </View>
      {steps.map((step, index) => (
        <StepRow
          key={`step-${index}`}
          index={index}
          step={step}
          onChange={(patch) => onChange(updateStep(steps, index, patch))}
          onRemove={() => onChange(removeStep(steps, index))}
        />
      ))}
      <Button label="Añadir paso" icon="add" variant="secondary" size="sm" onPress={() => onChange(addStep(steps, intensity))} />
    </View>
  );
}

function StepRow({
  index,
  step,
  onChange,
  onRemove,
}: {
  index: number;
  step: WorkoutStep;
  onChange: (patch: Partial<WorkoutStep>) => void;
  onRemove: () => void;
}) {
  const byDistance = step.durationMin == null && step.distanceM != null;
  return (
    <Card padding="md" style={styles.card}>
      <View style={styles.header}>
        <Text variant="bodyStrong">{`Paso ${index + 1}`}</Text>
        <IconButton icon="trash" accessibilityLabel={`Quitar paso ${index + 1}`} onPress={onRemove} size={36} />
      </View>
      <View style={styles.wrap}>
        {STEP_KINDS.map((kind) => (
          <Chip key={kind} label={stepKindLabel(kind)} selected={step.kind === kind} onPress={() => onChange({ kind })} />
        ))}
      </View>
      <View style={styles.steppers}>
        <View style={styles.flex}>
          {byDistance ? (
            <Stepper
              label="Metros"
              value={step.distanceM ?? 100}
              onChange={(distanceM) => onChange({ distanceM })}
              step={50}
              min={25}
              max={10000}
            />
          ) : (
            <Stepper
              label="Duración"
              value={step.durationMin ?? 10}
              onChange={(durationMin) => onChange({ durationMin })}
              step={1}
              min={1}
              max={360}
              format={formatDuration}
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
            format={(n) => `${n}×`}
          />
        </View>
      </View>
      <IntensityPicker value={step.intensity ?? 'endurance'} onChange={(i) => onChange({ intensity: i })} />
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  card: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  steppers: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
});
