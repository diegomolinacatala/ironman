import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { Chip, Stepper, Text, TextField, space } from '@/ui';

import { DateField, TimeField } from './DateField';
import { distanceUnit } from './draft';
import { applyTemplate, changeSport, type WorkoutFormState } from './form';
import { IntensityPicker, SportPicker } from './pickers';
import { StepsEditor } from './StepsEditor';
import { templatesFor } from './templates';

const MAX_DURATION_MIN = 12 * 60;

export interface WorkoutFormProps {
  state: WorkoutFormState;
  onChange: (next: WorkoutFormState) => void;
  titleError?: string | null;
}

/** Controlled workout editor fields (create + edit). */
export function WorkoutForm({ state, onChange, titleError }: WorkoutFormProps) {
  const set = <K extends keyof WorkoutFormState>(key: K, value: WorkoutFormState[K]) => onChange({ ...state, [key]: value });
  const templates = templatesFor(state.sport);
  const isRest = state.sport === 'rest';
  const hasDistance = !isRest && state.sport !== 'strength' && state.sport !== 'mobility';
  const unit = distanceUnit(state.sport);

  return (
    <View style={styles.root}>
      <Section label="Deporte">
        <SportPicker value={state.sport} onChange={(sport) => onChange(changeSport(state, sport))} />
      </Section>
      {templates.length > 0 ? (
        <Section label="Plantillas rápidas">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {templates.map((t) => (
              <Chip key={t.id} label={t.title} icon="sparkles" selected={state.title === t.title} onPress={() => onChange(applyTemplate(state, t))} />
            ))}
          </ScrollView>
        </Section>
      ) : null}
      <TextField
        label="Título"
        value={state.title}
        onChangeText={(title) => set('title', title)}
        placeholder="p. ej. Rodaje suave"
        error={titleError}
        maxLength={80}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <DateField label="Fecha" value={state.date} onChange={(date) => set('date', date)} />
        </View>
      </View>
      <TimeField label="Hora" value={state.startTime} onChange={(startTime) => set('startTime', startTime)} />
      {isRest ? null : (
        <>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Stepper
                label="Duración"
                value={state.durationMin}
                onChange={(d) => set('durationMin', d)}
                step={5}
                min={5}
                max={MAX_DURATION_MIN}
                format={formatDuration}
              />
            </View>
            {hasDistance ? (
              <View style={styles.flex}>
                <TextField
                  label={`Distancia (${unit})`}
                  value={state.distance}
                  onChangeText={(distance) => set('distance', distance)}
                  keyboardType="decimal-pad"
                  placeholder={unit === 'm' ? '2000' : '10'}
                />
              </View>
            ) : null}
          </View>
          <Section label="Intensidad">
            <IntensityPicker value={state.intensity} onChange={(i) => set('intensity', i)} />
          </Section>
          <Section label="Marcas">
            <View style={styles.chipsWrap}>
              <Chip
                label="★ Clave"
                selected={state.isKey}
                onPress={() => set('isKey', !state.isKey)}
              />
            </View>
            <Text variant="caption" color="textMuted">
              Las sesiones clave se protegen al reorganizar la semana.
            </Text>
          </Section>
        </>
      )}
      <TextField
        label="Descripción"
        value={state.description}
        onChangeText={(d) => set('description', d)}
        multiline
        placeholder="Objetivo, ritmos, notas…"
      />
      {isRest ? null : (
        <StepsEditor
          steps={state.steps}
          onChange={(steps) => set('steps', steps)}
          intensity={state.intensity}
          plannedMin={state.durationMin}
        />
      )}
    </View>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xl },
  section: { gap: space.sm },
  chips: { gap: space.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
