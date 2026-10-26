import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { DemoBanner } from '@/features/account/DemoBanner';
import { toWebcalUrl } from '@/features/settings/format';
import { SecretUrlBox } from '@/features/settings/SecretUrlBox';
import { StepCard } from '@/features/settings/StepCard';
import { TokenList } from '@/features/settings/TokenList';
import { useTokenGenerator } from '@/features/settings/useTokenGenerator';
import { logger } from '@/lib/logger';
import { Button, ErrorNotice, Icon, Screen, SectionHeader, Text, space, useTheme } from '@/ui';

const WHAT_YOU_GET = [
  'Tus entrenos de las últimas 2 semanas y las próximas 8, con hora si la tienen.',
  'Las quedadas confirmadas con tus amigos.',
  'Se actualiza solo: el iPhone lo refresca periódicamente.',
] as const;

export default function CalendarFeedScreen() {
  const { colors } = useTheme();
  const { mode } = useAuth();
  const generator = useTokenGenerator('ics', 'Calendario');
  const [openError, setOpenError] = useState<string | null>(null);
  const webcal = generator.created ? toWebcalUrl(generator.created.url) : null;

  const addToCalendar = async (url: string) => {
    setOpenError(null);
    try {
      await Linking.openURL(url);
    } catch (err) {
      logger.warn('open webcal failed', err);
      setOpenError('No se pudo abrir Calendario. Copia la URL y añádela en Ajustes → Calendario → Cuentas → Añadir calendario suscrito.');
    }
  };

  return (
    <Screen inSheet>
      <View style={styles.intro}>
        <Text variant="title">Tus entrenos en el Calendario del iPhone</Text>
        {WHAT_YOU_GET.map((line) => (
          <View key={line} style={styles.bullet}>
            <Icon name="check" size={14} color={colors.success} />
            <Text variant="callout" style={styles.flex}>
              {line}
            </Text>
          </View>
        ))}
      </View>
      {mode === 'demo' ? (
        <DemoBanner message="La suscripción necesita el servidor de Road to Ironman (Supabase): en la demo la URL generada es de ejemplo y no funcionará." />
      ) : null}
      <StepCard number={1} title="Genera tu enlace" done={Boolean(webcal)}>
        {webcal ? (
          <SecretUrlBox
            label="URL de suscripción"
            url={webcal}
            warning="Quien tenga esta URL puede ver tus entrenos. Solo la verás ahora; si la compartes sin querer, revócala abajo.">
            <Button label="Añadir a Calendario" variant="secondary" icon="calendarBadge" onPress={() => void addToCalendar(webcal)} />
          </SecretUrlBox>
        ) : (
          <Button
            label="Generar enlace de calendario"
            icon="key"
            size="lg"
            fullWidth
            loading={generator.generating}
            disabled={generator.limitReached}
            onPress={() => void generator.generate()}
          />
        )}
        {generator.error ? <ErrorNotice message={generator.error} /> : null}
        {openError ? <ErrorNotice message={openError} /> : null}
      </StepCard>
      <StepCard number={2} title="Suscríbete">
        <Text variant="callout" color="textMuted">
          Pulsa “Añadir a Calendario” y confirma “Suscribirse”. Es de solo lectura: los cambios se hacen en Road to Ironman.
        </Text>
      </StepCard>
      <SectionHeader title="Enlaces activos" />
      <TokenList
        scope="ics"
        emptyText="Aún no tienes ningún enlace de calendario."
        revokeMessage="El calendario suscrito dejará de actualizarse. Bórralo también en el iPhone."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
