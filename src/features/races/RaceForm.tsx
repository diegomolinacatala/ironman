import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ISODate, Race, RaceDraft, RacePrep, RacePriority } from '@/domain/types';
import { FormFooter } from '@/features/workouts/FormFooter';
import { FormScreen } from '@/features/workouts/FormScreen';
import { Button, Disclosure, Segmented, Text, TextField, fonts, space } from '@/ui';

import { DistancePicker } from './DistancePicker';
import { RaceDateField } from './RaceDateField';
import { PREP_OPTIONS, defaultRaceName, formPrep, initialRaceForm, prepHint, validateRaceForm, type RaceFormState } from './raceFormModel';
import { PRIORITIES, PRIORITY_INFO } from './raceModel';

export interface RaceFormProps {
  race: Race | null;
  today: ISODate;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  onSave: (draft: RaceDraft) => void;
  onDelete?: () => void;
  /** No race yet: this one defaults to A (the season goal). */
  isFirstRace?: boolean;
}

/** Create / edit race form (modal body). */
export function RaceForm({ race, today, saving, deleting, error, onSave, onDelete, isFirstRace = false }: RaceFormProps) {
  const [form, setForm] = useState<RaceFormState>(() => initialRaceForm(race, today, isFirstRace));
  const hasDetails = Boolean(form.location || form.goal || form.notes);
  // B/C races: how the athlete prepares it (null for A races, which always get the full taper).
  const prep = formPrep(form);
  const [validation, setValidation] = useState<string | null>(null);
  const set = <K extends keyof RaceFormState>(key: K, value: RaceFormState[K]) => {
    setValidation(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = () => {
    const result = validateRaceForm(form);
    if (!result.ok) {
      setValidation(result.error);
      return;
    }
    setValidation(null);
    onSave(result.draft);
  };

  // Errors live in the pinned footer so they are visible wherever the form is scrolled.
  const footer = (
    <FormFooter errors={[validation, error]}>
      <Button
        label={race ? 'Guardar cambios' : 'Añadir carrera'}
        icon="check"
        size="lg"
        fullWidth
        loading={saving}
        disabled={deleting}
        onPress={submit}
      />
    </FormFooter>
  );

  return (
    <FormScreen inSheet footer={footer} contentStyle={styles.content}>
      <TextField
        label="Nombre"
        value={form.name}
        onChangeText={(v) => set('name', v)}
        placeholder={`Opcional: ${defaultRaceName(form.distance, form.date)}`}
        accessibilityLabel="Nombre de la carrera"
        maxLength={80}
        returnKeyType="next"
      />
      <RaceDateField value={form.date} onChange={(v) => set('date', v)} />
      <DistancePicker value={form.distance} onChange={(v) => set('distance', v)} />
      <View style={styles.field}>
        <Text variant="caption" color="textMuted" style={styles.label}>
          Prioridad
        </Text>
        <Segmented<RacePriority>
          accessibilityLabel="Prioridad de la carrera"
          options={PRIORITIES.map((p) => ({ value: p, label: `${p} · ${PRIORITY_INFO[p].title}` }))}
          value={form.priority}
          onChange={(v) => set('priority', v)}
        />
        {prep === null ? (
          <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
            {PRIORITY_INFO[form.priority].help}
          </Text>
        ) : null}
      </View>
      {prep !== null ? (
        <View style={styles.field}>
          <Text variant="caption" color="textMuted" style={styles.label}>
            ¿Cómo la preparas?
          </Text>
          <Segmented<RacePrep>
            accessibilityLabel="Cómo preparas la carrera"
            options={PREP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={prep}
            onChange={(v) => set('prep', v)}
          />
          <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
            {prepHint(prep)}
          </Text>
        </View>
      ) : null}
      <Disclosure
        variant="plain"
        title="Más detalles"
        summary={hasDetails ? [form.location, form.goal].filter(Boolean).join(' · ') || 'Con notas' : 'Lugar, objetivo y notas (opcional)'}
        defaultOpen={hasDetails}>
        <View style={styles.details}>
          <TextField
            label="Lugar"
            value={form.location}
            onChangeText={(v) => set('location', v)}
            placeholder="Valencia"
            accessibilityLabel="Lugar"
            maxLength={80}
          />
          <TextField
            label="Objetivo"
            value={form.goal}
            onChangeText={(v) => set('goal', v)}
            placeholder="Terminar sonriendo, sub 5h…"
            accessibilityLabel="Objetivo"
            maxLength={120}
          />
          <TextField
            label="Notas"
            value={form.notes}
            onChangeText={(v) => set('notes', v)}
            placeholder="Inscripción, logística, cosas a tener en cuenta…"
            accessibilityLabel="Notas"
            multiline
            maxLength={1000}
          />
        </View>
      </Disclosure>
      {onDelete ? (
        <Button label="Eliminar carrera" icon="trash" variant="danger" loading={deleting} disabled={saving} onPress={onDelete} />
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl },
  field: { gap: space.xs },
  label: { fontFamily: fonts.bodySemibold },
  details: { gap: space.xl },
});
