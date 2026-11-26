import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, ErrorNotice, ListRow, Stack, Text, space, useTheme, type IconName } from '@/ui';

export interface SourceListProps {
  error: string | null;
  isDemo: boolean;
  onCamera: () => void;
  onLibrary: () => void;
  onPdf: () => void;
  onSheet: () => void;
  onText: () => void;
  onFeed: () => void;
  onGarmin: () => void;
}

interface SourceRow {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  ai?: boolean;
}

/** First step: where the plan comes from. One calm list, AI sources marked. */
export function SourceList(props: SourceListProps) {
  const { colors } = useTheme();
  const rows: SourceRow[] = [
    { icon: 'camera', title: 'Hacer una foto', subtitle: 'De la hoja o la pizarra de tu entrenador', onPress: props.onCamera, ai: true },
    { icon: 'photo', title: 'Foto o captura de la galería', subtitle: 'Una captura del PDF o del mensaje también vale', onPress: props.onLibrary, ai: true },
    { icon: 'book', title: 'PDF', subtitle: 'El plan que te ha enviado tu entrenador', onPress: props.onPdf, ai: true },
    { icon: 'week', title: 'Excel o CSV', subtitle: 'Una sesión por fila, o una semana por fila con los días en columnas', onPress: props.onSheet },
    { icon: 'clipboard', title: 'Pegar el texto', subtitle: '«Semana 1 · Lunes: rodaje 45\' Z2…»', onPress: props.onText },
    { icon: 'link', title: 'TrainingPeaks', subtitle: 'Con el enlace de su calendario (cuenta Premium)', onPress: props.onFeed },
    { icon: 'watch', title: 'Garmin Connect', subtitle: 'Por qué no se puede leer su calendario', onPress: props.onGarmin },
  ];
  return (
    <Stack gap="lg">
      <Text variant="body" color="textMuted">
        Trae el plan de tu entrenador. Lo reviso contigo, lo coloco en tus semanas y desde entonces la app lo adapta a tus imprevistos, tu disponibilidad y cómo te encuentras, en vez de hacer el suyo.
      </Text>
      {props.error ? <ErrorNotice message={props.error} /> : null}
      <Card padding="xs">
        {rows.map((row, index) => (
          <Fragment key={row.title}>
            {index > 0 ? <Divider inset={48} /> : null}
            <ListRow
              icon={row.icon}
              title={row.title}
              subtitle={row.ai && props.isDemo ? `${row.subtitle} · necesita el servidor` : row.subtitle}
              iconTint={row.ai ? colors.accentSoft : undefined}
              iconColor={row.ai ? colors.onAccentSoft : undefined}
              onPress={row.onPress}
            />
          </Fragment>
        ))}
      </Card>
      <View style={styles.note}>
        <Text variant="caption" color="textMuted">
          Las fotos y los PDF los lee la IA gratuita del coach (Cloudflare Workers AI). El Excel, el CSV y el calendario se leen en tu iPhone.
        </Text>
      </View>
    </Stack>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: space.xs },
});
