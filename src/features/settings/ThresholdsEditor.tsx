import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Sport, Thresholds } from '@/domain/types';
import { ZoneTag } from '@/features/workouts/IntensityTag';
import { Card, Divider, Icon, Segmented, SportBadge, Text, TextField, radius, space, useTheme } from '@/ui';

import {
  ZONE_PREVIEW_SPORTS,
  parseThresholdInputs,
  zonePreviewNote,
  zonePreviewRows,
  type ThresholdInputs,
  type ThresholdKey,
  type ZonePreviewSport,
} from './thresholdsModel';

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
    hint: 'Potencia que aguantas ~1 h. En tu reloj (Garmin o COROS): FTP o potencia umbral.',
    numeric: true,
  },
  {
    key: 'runPace',
    sport: 'run',
    label: 'Ritmo umbral carrera (min/km)',
    placeholder: '4:30',
    hint: 'El ritmo de un 10K a tope, aprox. Formato mm:ss. En tu reloj (Garmin o COROS): ritmo umbral.',
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
    hint: "Media de los últimos 20' de un test de 30' a tope. En tu reloj (Garmin o COROS): FC de umbral de lactato.",
    numeric: true,
  },
  {
    key: 'restingHr',
    sport: null,
    label: 'FC en reposo (ppm)',
    placeholder: '48',
    hint: 'Al despertar, antes de levantarte. Tu reloj (Garmin o COROS) la mide cada noche.',
    numeric: true,
  },
];

const INTRO =
  'Con estos datos, cada sesión te dice a qué pulsaciones, ritmo o vatios ir. ¿No los sabes? Déjalos vacíos y te guiamos por sensaciones (RPE); si tu reloj ya los calcula, cópialos aquí.';

export interface ThresholdsEditorProps {
  value: ThresholdInputs;
  onChange: (next: ThresholdInputs) => void;
}

/** Optional thresholds (settings › Perfil) with a live "Tus zonas" preview. */
export function ThresholdsEditor({ value, onChange }: ThresholdsEditorProps) {
  const { errors, thresholds } = useMemo(() => parseThresholdInputs(value), [value]);
  return (
    <View style={styles.wrap}>
      <Text variant="callout" color="textMuted">
        {INTRO}
      </Text>
      {FIELDS.map((field) => (
        <View key={field.key} style={styles.row}>
          <View style={styles.badge}>{field.sport ? <SportBadge sport={field.sport} size={32} /> : <HeartBadge />}</View>
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
      <Text variant="caption" color="textMuted">
        Pon los mismos valores en tu reloj para que sus zonas y las de tus sesiones coincidan.
      </Text>
      <ZonesPreview thresholds={thresholds} />
    </View>
  );
}

/** Z1–Z5 per sport with the numbers the sessions will use, updated as the athlete types. */
function ZonesPreview({ thresholds }: { thresholds: Thresholds }) {
  const [sport, setSport] = useState<ZonePreviewSport>('run');
  const rows = useMemo(() => zonePreviewRows(thresholds, sport), [thresholds, sport]);
  const note = useMemo(() => zonePreviewNote(thresholds, sport), [thresholds, sport]);
  return (
    <View style={styles.zones}>
      <Text variant="heading" accessibilityRole="header">
        Tus zonas
      </Text>
      <Segmented options={[...ZONE_PREVIEW_SPORTS]} value={sport} onChange={setSport} accessibilityLabel="Deporte de las zonas" />
      <Card padding="md" style={styles.zoneList}>
        {rows.map((row, index) => (
          <View key={row.zone} style={styles.zoneList}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.zoneRow} accessible accessibilityLabel={`${row.zone}, ${row.name}: ${row.values}`}>
              <ZoneTag intensity={row.intensity} zone={row.zone} />
              <View style={styles.field}>
                <Text variant="caption" color="textMuted">
                  {row.name}
                </Text>
                <Text variant="callout" style={styles.tabular}>
                  {row.values}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </Card>
      {note ? (
        <Text variant="caption" color="textMuted">
          {note}
        </Text>
      ) : null}
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
  field: { flex: 1, gap: 2 },
  zones: { gap: space.md },
  zoneList: { gap: space.sm },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tabular: { fontVariant: ['tabular-nums'] },
});
