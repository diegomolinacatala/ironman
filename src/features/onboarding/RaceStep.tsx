import { StyleSheet, View } from 'react-native';

import { raceDistanceDetail, raceDistanceLabel } from '@/domain/labels';
import { RACE_DISTANCES, type ISODate, type RacePriority } from '@/domain/types';
import { firstError, raceDraftSchema } from '@/domain/validation';
import { Chip, Segmented, Text, TextField, space } from '@/ui';

import { DateField } from '../settings/DateField';
import { hasRaceInput, type RaceInput } from './onboardingModel';

const PRIORITIES: readonly { value: RacePriority; label: string }[] = [
  { value: 'A', label: 'A · Objetivo' },
  { value: 'B', label: 'B · Importante' },
  { value: 'C', label: 'C · Rodaje' },
];

const PRIORITY_HELP: Record<RacePriority, string> = {
  A: 'La carrera de la temporada: el plan se periodiza y afina para ella.',
  B: 'Cuenta, pero sin afinado largo: un par de días de descarga.',
  C: 'Para coger ritmo de competición. Se trata como un entreno duro.',
};

/** Spanish error for the optional race step, or null when empty/valid. */
export function validateRaceInput(race: RaceInput, today: ISODate): string | null {
  if (!hasRaceInput(race)) return null;
  if (!race.name.trim()) return 'Ponle un nombre a la carrera';
  if (!race.date) return 'Elige la fecha';
  if (race.date < today) return 'La fecha ya ha pasado';
  const result = raceDraftSchema.safeParse({
    name: race.name.trim(),
    date: race.date,
    distance: race.distance,
    priority: race.priority,
  });
  return result.success ? null : (firstError(result) ?? 'Revisa los datos de la carrera');
}

export interface RaceStepProps {
  value: RaceInput;
  onChange: (next: RaceInput) => void;
  today: ISODate;
  error: string | null;
}

export function RaceStep({ value, onChange, today, error }: RaceStepProps) {
  const touched = hasRaceInput(value);
  return (
    <View style={styles.wrap}>
      <TextField
        label="Nombre"
        value={value.name}
        placeholder="Triatlón de Valencia"
        autoCapitalize="words"
        maxLength={80}
        onChangeText={(name) => onChange({ ...value, name })}
      />
      <DateField
        label="Fecha"
        value={value.date}
        minimumDate={today}
        onChange={(date) => onChange({ ...value, date })}
      />
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Distancia
        </Text>
        <View style={styles.chips}>
          {RACE_DISTANCES.map((distance) => (
            <Chip
              key={distance}
              label={raceDistanceLabel(distance)}
              selected={value.distance === distance}
              onPress={() => onChange({ ...value, distance })}
            />
          ))}
        </View>
        <Text variant="caption" color="textMuted">
          {raceDistanceDetail(value.distance)}
        </Text>
      </View>
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Prioridad
        </Text>
        <Segmented
          accessibilityLabel="Prioridad"
          options={[...PRIORITIES]}
          value={value.priority}
          onChange={(priority) => onChange({ ...value, priority })}
        />
        <Text variant="caption" color="textMuted">
          {PRIORITY_HELP[value.priority]}
        </Text>
      </View>
      {touched && error ? (
        <Text variant="callout" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {!touched ? (
        <Text variant="caption" color="textMuted">
          ¿Aún sin carrera? Sáltalo: el plan trabajará la base y podrás añadirla en Yo → Carreras.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
