import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Sport } from '@/domain/types';
import { Icon, SportBadge, Text, TextField, radius, space, useTheme } from '@/ui';

import { parseThresholdInputs, type ThresholdInputs, type ThresholdKey } from './thresholdsModel';

interface FieldSpec {
  key: ThresholdKey;
  /** null = heart-rate field. */
  sport: Sport | null;
  label: string;
  placeholder: string;
  hint: string;
  numeric: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'ftpW',
    sport: 'bike',
    label: 'FTP bici (W)',
    placeholder: '230',
    hint: 'Potencia que aguantas ~1 h. En Garmin: Rendimiento → FTP.',
    numeric: true,
  },
  {
    key: 'runPace',
    sport: 'run',
    label: 'Ritmo umbral carrera (min/km)',
    placeholder: '4:30',
    hint: 'El ritmo de un 10K a tope, aprox. Formato mm:ss.',
    numeric: false,
  },
  {
    key: 'swimCss',
    sport: 'swim',
    label: 'CSS natación (min/100 m)',
    placeholder: '1:45',
    hint: 'Ritmo crítico: test de 400 m y 200 m. Formato mm:ss.',
    numeric: false,
  },
  {
    key: 'maxHr',
    sport: null,
    label: 'FC máxima (ppm)',
    placeholder: '190',
    hint: 'La más alta que hayas visto en un esfuerzo máximo.',
    numeric: true,
  },
  {
    key: 'lthr',
    sport: null,
    label: 'FC umbral (ppm)',
    placeholder: '172',
    hint: 'Media de los últimos 20 min de un test de 30 min a tope.',
    numeric: true,
  },
];

export interface ThresholdsEditorProps {
  value: ThresholdInputs;
  onChange: (next: ThresholdInputs) => void;
}

/** Optional thresholds (shared by onboarding step 4 and settings/profile). */
export function ThresholdsEditor({ value, onChange }: ThresholdsEditorProps) {
  const { errors } = useMemo(() => parseThresholdInputs(value), [value]);
  return (
    <View style={styles.wrap}>
      <Text variant="callout" color="textMuted">
        ¿No los sabes? Déjalos vacíos: el coach usará la percepción de esfuerzo (RPE) y los irá afinando con tus
        datos de Garmin.
      </Text>
      {FIELDS.map((field) => (
        <View key={field.key} style={styles.row}>
          <View style={styles.badge}>
            {field.sport ? <SportBadge sport={field.sport} size={32} /> : <HeartBadge />}
          </View>
          <View style={styles.field}>
            <TextField
              label={field.label}
              value={value[field.key]}
              placeholder={field.placeholder}
              keyboardType={field.numeric ? 'number-pad' : 'numbers-and-punctuation'}
              autoCorrect={false}
              maxLength={field.numeric ? 4 : 5}
              error={errors[field.key] ?? null}
              hint={field.hint}
              onChangeText={(text) => onChange({ ...value, [field.key]: text })}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function HeartBadge() {
  const { colors } = useTheme();
  return (
    <View style={[styles.heart, { backgroundColor: `${colors.danger}1F` }]}>
      <Icon name="heart" size={16} color={colors.danger} />
    </View>
  );
}

const styles = StyleSheet.create({
  heart: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  wrap: { gap: space.lg },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  badge: { paddingTop: 22 },
  field: { flex: 1 },
});
