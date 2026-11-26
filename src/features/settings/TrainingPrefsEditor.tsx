import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { sportLabel, weekdayLabel } from '@/domain/labels';
import { INTENSITY_MODELS, INTENSITY_MODEL_OPTIONS, MAX_FIXED_SESSIONS } from '@/domain/trainingPrefs';
import type { PrefSport, TrainingPrefs, Weekday } from '@/domain/types';
import { Button, Card, Chip, IconButton, SectionHeader, Stepper, Text, TextField, space, useTheme } from '@/ui';

import { WEEKDAYS } from './availabilityModel';
import { DayPicker } from './DayPicker';
import { FormLabel } from './FormLabel';
import {
  AUTO_COUNT,
  EMPTY_FIXED,
  addFixed,
  countLabel,
  countValue,
  fixedDraftError,
  maxCount,
  removeFixed,
  setCount,
  toggleLongDay,
  togglePreferredDay,
  type FixedDraft,
} from './trainingPrefsModel';

export interface TrainingPrefsEditorProps {
  value: TrainingPrefs;
  onChange: (next: TrainingPrefs) => void;
  /** The athlete's sports (strength only when they train it). */
  sports: readonly PrefSport[];
}

const DAYS_HINT: Readonly<Record<PrefSport, string>> = {
  swim: 'Por ejemplo, los días que abre tu piscina.',
  bike: 'Las salidas cortas y la calidad irán mejor estos días.',
  run: 'Los rodajes y las series irán mejor estos días.',
  strength: 'El gimnasio irá mejor estos días.',
};

/**
 * «Tu forma de entrenar»: sessions per sport, preferred days, the intensity
 * model and the fixed weekly sessions. Everything starts in «Automático».
 */
export function TrainingPrefsEditor({ value, onChange, sports }: TrainingPrefsEditorProps) {
  const { sport: sportTheme } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.section}>
        <SectionHeader title="Sesiones por semana" />
        <Text variant="callout" color="textMuted">
          Dentro de las horas de tu semana. Si no te caben, el plan hace las sesiones más cortas, nunca por debajo de lo útil.
        </Text>
        {sports.map((s) => (
          <Stepper
            key={s}
            label={sportLabel(s)}
            value={countValue(value, s)}
            step={1}
            min={AUTO_COUNT}
            max={maxCount(s)}
            format={countLabel}
            onChange={(n) => onChange(setCount(value, s, n))}
          />
        ))}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Tus días" />
        <Text variant="callout" color="textMuted">
          Sin marcar, cualquier día. Son preferencias: si un día no cabe, el plan busca otro.
        </Text>
        {sports.includes('bike') ? (
          <DayPicker
            label="Bici larga"
            hint={value.longRideDays.length === 0 ? 'Automático: tus días de sesión larga.' : undefined}
            selected={value.longRideDays}
            color={sportTheme('bike').base}
            onToggle={(day) => onChange(toggleLongDay(value, 'longRideDays', day))}
          />
        ) : null}
        {sports.includes('run') ? (
          <DayPicker
            label="Tirada larga"
            hint={value.longRunDays.length === 0 ? 'Automático: tus días de sesión larga.' : undefined}
            selected={value.longRunDays}
            color={sportTheme('run').base}
            onToggle={(day) => onChange(toggleLongDay(value, 'longRunDays', day))}
          />
        ) : null}
        {sports.map((s) => (
          <DayPicker
            key={s}
            label={s === 'swim' ? 'Piscina' : sportLabel(s)}
            hint={DAYS_HINT[s]}
            selected={value.preferredDays[s] ?? []}
            color={sportTheme(s).base}
            onToggle={(day) => onChange(togglePreferredDay(value, s, day))}
          />
        ))}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Intensidad" />
        <View style={styles.chips}>
          {INTENSITY_MODELS.map((m) => (
            <Chip
              key={m}
              label={INTENSITY_MODEL_OPTIONS[m].label}
              selected={value.intensityModel === m}
              onPress={() => onChange({ ...value, intensityModel: m })}
            />
          ))}
        </View>
        <Text variant="callout" color="textMuted">
          {INTENSITY_MODEL_OPTIONS[value.intensityModel].help}
        </Text>
      </View>

      <FixedSessions value={value} onChange={onChange} sports={sports} />
    </View>
  );
}

function fixedLine(f: TrainingPrefs['fixedSessions'][number]): string {
  return `${weekdayLabel(f.weekday)}${f.startTime ? ` a las ${f.startTime}` : ''} · ${f.durationMin} min · ${sportLabel(f.sport)}`;
}

function FixedSessions({ value, onChange, sports }: TrainingPrefsEditorProps) {
  const [draft, setDraft] = useState<FixedDraft>({ ...EMPTY_FIXED, sport: sports[0] ?? 'swim' });
  const [error, setError] = useState<string | null>(null);
  const full = value.fixedSessions.length >= MAX_FIXED_SESSIONS;
  const add = () => {
    const problem = fixedDraftError(draft, value.fixedSessions.length);
    setError(problem);
    if (problem) return;
    onChange(addFixed(value, draft));
    setDraft({ ...EMPTY_FIXED, sport: draft.sport });
  };
  return (
    <View style={styles.section}>
      <SectionHeader title="Sesiones fijas" />
      <Text variant="callout" color="textMuted">
        Lo que haces todas las semanas, como la natación del club. Aparecen en cada semana del plan y el resto se organiza alrededor.
      </Text>
      {value.fixedSessions.map((f, index) => (
        <Card key={`${f.weekday}-${f.startTime ?? ''}-${f.sport}-${index}`} padding="md">
          <View style={styles.fixedRow}>
            <View style={styles.fixedText}>
              <Text variant="bodyStrong">{f.title}</Text>
              <Text variant="caption" color="textMuted">
                {fixedLine(f)}
              </Text>
            </View>
            <IconButton icon="trash" accessibilityLabel={`Quitar ${f.title}`} onPress={() => onChange(removeFixed(value, index))} />
          </View>
        </Card>
      ))}
      {full ? null : (
        <Card padding="md">
          <View style={styles.form}>
            <FormLabel>Nueva sesión fija</FormLabel>
            <View style={styles.chips}>
              {sports.map((s) => (
                <Chip key={s} label={sportLabel(s)} selected={draft.sport === s} onPress={() => setDraft({ ...draft, sport: s })} />
              ))}
            </View>
            <View style={styles.chips} accessibilityLabel="Día de la sesión fija">
              {WEEKDAYS.map((day: Weekday) => (
                <Chip key={day} label={weekdayLabel(day)} selected={draft.weekday === day} onPress={() => setDraft({ ...draft, weekday: day })} />
              ))}
            </View>
            <TextField
              label="Hora (opcional)"
              placeholder="20:00"
              value={draft.startTime}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              onChangeText={(startTime) => setDraft({ ...draft, startTime })}
            />
            <Stepper
              label="Duración"
              value={draft.durationMin}
              step={5}
              min={10}
              max={360}
              format={(m) => `${m} min`}
              onChange={(durationMin) => setDraft({ ...draft, durationMin })}
            />
            <TextField
              label="Nombre (opcional)"
              placeholder="Natación del club"
              value={draft.title}
              maxLength={60}
              onChangeText={(title) => setDraft({ ...draft, title })}
            />
            {error ? (
              <Text variant="caption" color="danger">
                {error}
              </Text>
            ) : null}
            <Button label="Añadir sesión fija" icon="add" variant="secondary" onPress={add} />
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xxl },
  section: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  form: { gap: space.md },
  fixedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fixedText: { flex: 1, gap: space.xxs },
});
