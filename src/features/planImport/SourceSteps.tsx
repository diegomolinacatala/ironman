import { StyleSheet, View } from 'react-native';

import { planColumnLabel, PLAN_COLUMNS } from '@/domain/planImportTable';
import type { ColumnMapping, PlanColumn, TableParse } from '@/domain/planImportTable';
import { Card, Chip, ErrorNotice, Icon, Loading, Stack, Text, TextField, space, useTheme } from '@/ui';

export function PasteTextStep({ text, error, onText }: { text: string; error: string | null; onText: (text: string) => void }) {
  return (
    <Stack gap="md">
      <Text variant="body" color="textMuted">
        Pega el plan tal cual te lo mandó tu entrenador (WhatsApp, correo, notas). Mejor con una línea por día y las semanas marcadas.
      </Text>
      <TextField
        label="Tu plan"
        value={text}
        onChangeText={onText}
        multiline
        placeholder={"Semana 1\nLunes: descanso\nMartes: rodaje 45' Z2\nJueves: bici 1h30 con 3x10' Z4\nDomingo: tirada larga 1h15 suave"}
        autoCorrect={false}
        maxLength={20000}
      />
      {error ? <ErrorNotice message={error} /> : null}
    </Stack>
  );
}

export function FeedStep({ url, error, onUrl }: { url: string; error: string | null; onUrl: (url: string) => void }) {
  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <Text variant="heading">Cómo conseguir el enlace</Text>
          <Text variant="callout">1. En trainingpeaks.com (en la web), abre Settings › Account › Calendar o «Calendar sync».</Text>
          <Text variant="callout">2. Copia el enlace webcal:// o https:// del calendario.</Text>
          <Text variant="callout">3. Pégalo aquí.</Text>
          <Text variant="caption" color="textMuted">
            TrainingPeaks solo da este enlace a las cuentas Premium, y el calendario trae los días cercanos: unos 5 días atrás y 14 por delante, con el nombre, el deporte, la duración y la descripción de cada sesión. Vuelve a importarlo cuando tu entrenador cargue más semanas.
          </Text>
        </Stack>
      </Card>
      <TextField
        label="Enlace del calendario"
        value={url}
        onChangeText={onUrl}
        placeholder="webcal://www.trainingpeaks.com/ical/…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint="El enlace es privado: lo usa tu iPhone para descargar el calendario y no lo guardamos."
      />
      {error ? <ErrorNotice message={error} /> : null}
    </Stack>
  );
}

export function GarminInfo() {
  const { colors } = useTheme();
  return (
    <Card>
      <Stack gap="sm">
        <View style={styles.row}>
          <Icon name="info" size={20} color={colors.accentInk} />
          <Text variant="heading">Garmin no deja leer su calendario</Text>
        </View>
        <Text variant="callout">
          La conexión de Garmin que usa la app (la Personal API de Garmin Connect) solo da tus datos de salud y tus actividades hechas: sueño, VFC, Body Battery y entrenos completados. No ofrece los entrenos programados ni los planes de Garmin Coach.
        </Text>
        <Text variant="callout">
          Garmin solo permite escribir en ese calendario a empresas aprobadas (Training API), no leerlo. Por eso, para traer un plan de Garmin Connect:
        </Text>
        <Text variant="callout">· Haz una captura de tu calendario de Garmin Connect y súbela como foto.</Text>
        <Text variant="callout">· Si tu entrenador lo carga en TrainingPeaks, usa su enlace de calendario.</Text>
        <Text variant="caption" color="textMuted">Tus actividades de Garmin siguen entrando solas y completan las sesiones del plan importado.</Text>
      </Stack>
    </Card>
  );
}

export function ReadingStep({ label }: { label: string }) {
  return <Loading label={label} />;
}

const PREVIEW_ROWS = 3;

export function ColumnMappingStep({
  table,
  mapping,
  error,
  onColumn,
}: {
  table: TableParse;
  mapping: ColumnMapping;
  error: string | null;
  onColumn: (index: number, column: PlanColumn) => void;
}) {
  return (
    <Stack gap="lg">
      <Text variant="body" color="textMuted">
        No reconozco todas las columnas. Dime qué hay en cada una: necesito al menos la fecha o el día de la semana, y el deporte, la sesión o la descripción.
      </Text>
      {error ? <ErrorNotice message={error} /> : null}
      {table.headers.map((header, index) => {
        const sample = table.rows
          .slice(0, PREVIEW_ROWS)
          .map((r) => r[index] ?? '')
          .filter(Boolean)
          .join(' · ');
        return (
          <Card key={`${header}-${index}`}>
            <Stack gap="sm">
              <Text variant="bodyStrong">{header || `Columna ${index + 1}`}</Text>
              {sample ? (
                <Text variant="caption" color="textMuted" numberOfLines={2}>
                  {sample}
                </Text>
              ) : null}
              <View style={styles.chips}>
                {PLAN_COLUMNS.map((column) => (
                  <Chip key={column} label={planColumnLabel(column)} selected={mapping[index] === column} onPress={() => onColumn(index, column)} />
                ))}
              </View>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
