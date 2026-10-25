import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/domain/dates';
import { bodyAreaLabel, lifeEventLabel } from '@/domain/labels';
import { BODY_AREAS } from '@/domain/types';
import { Chip, Stepper, Text, TextField, space } from '@/ui';

import { DateField, TimeField } from '@/features/workouts/DateField';

import { changeStartDate, type EventFormState } from './eventForm';
import { hasTime, kindGroup } from './kinds';
import { SeverityPicker } from './SeverityPicker';

const MAX_SPORT_MIN = 6 * 60;

export interface EventFieldsProps {
  state: EventFormState;
  onChange: (next: EventFormState) => void;
}

/** Fields that adapt to the kind: sports, injury or date-range events. */
export function EventFields({ state, onChange }: EventFieldsProps) {
  const group = kindGroup(state.kind);
  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => onChange({ ...state, [key]: value });
  const severityTitle = group === 'sport' ? 'Intensidad' : group === 'injury' ? 'Gravedad' : 'Cuánto te afecta';

  return (
    <View style={styles.root}>
      <DateField
        label={group === 'sport' ? 'Día' : 'Desde'}
        value={state.startDate}
        onChange={(d) => onChange(changeStartDate(state, d))}
      />
      {group !== 'sport' ? <DateField label="Hasta (incluido)" value={state.endDate} onChange={(d) => set('endDate', d)} /> : null}
      {hasTime(state.kind) ? (
        <TimeField label="Hora" value={state.startTime} onChange={(t) => set('startTime', t)} optional={group !== 'sport'} />
      ) : null}
      {group === 'sport' ? (
        <Stepper
          label="Duración"
          value={state.durationMin}
          onChange={(d) => set('durationMin', d)}
          step={15}
          min={15}
          max={MAX_SPORT_MIN}
          format={formatDuration}
        />
      ) : null}
      {group === 'injury' ? (
        <Field label="Zona">
          <View style={styles.wrap}>
            {BODY_AREAS.map((area) => (
              <Chip key={area} label={bodyAreaLabel(area)} selected={state.bodyArea === area} onPress={() => set('bodyArea', area)} />
            ))}
          </View>
        </Field>
      ) : null}
      <Field label={severityTitle}>
        <SeverityPicker kind={state.kind} value={state.severity} onChange={(s) => set('severity', s)} label={severityTitle} />
      </Field>
      {group === 'injury' ? (
        <Text variant="caption" color="textMuted">
          Si el dolor es fuerte, no mejora en unos días o te hace cojear, consulta a un profesional sanitario.
        </Text>
      ) : null}
      <TextField
        label="Título (opcional)"
        value={state.title}
        onChangeText={(title) => set('title', title)}
        placeholder={lifeEventLabel(state.kind)}
        maxLength={80}
      />
      <TextField label="Notas" value={state.notes} onChangeText={(notes) => set('notes', notes)} multiline placeholder="Cualquier detalle útil para reorganizar" />
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.lg },
  field: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
