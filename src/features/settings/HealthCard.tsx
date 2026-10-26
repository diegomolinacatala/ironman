import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { useHealthIntegration } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Text, space } from '@/ui';

import { confirmAction } from './confirm';
import { formatRelativeTime } from './format';
import { IntegrationCard } from './IntegrationCard';

/** Apple Health (HealthKit, on device): what Garmin Connect writes there. */
export function HealthCard() {
  const health = useHealthIntegration();
  const [error, setError] = useState<string | null>(null);
  const status = !health.available
    ? { tone: 'muted' as const, label: 'Solo en iPhone' }
    : health.enabled
      ? { tone: 'success' as const, label: 'Conectado' }
      : { tone: 'muted' as const, label: 'Sin conectar' };

  const run = async (task: () => Promise<void>, fallback: string) => {
    setError(null);
    try {
      await task();
    } catch (err) {
      logger.warn('health action failed', err);
      setError(errorMessage(err, fallback));
    }
  };

  const disable = async () => {
    const ok = await confirmAction({
      title: '¿Desactivar Apple Salud?',
      message: 'Dejaremos de leer Salud. Para quitar el permiso del todo: Ajustes → Salud → Acceso a datos → Road to Ironman.',
      confirmLabel: 'Desactivar',
      destructive: true,
    });
    if (ok) await run(() => health.disable(), 'No se pudo desactivar.');
  };

  return (
    <IntegrationCard icon="health" title="Apple Salud" status={status}>
      <Text variant="callout" color="textMuted">
        Si en Garmin Connect activas “Apple Salud”, tus entrenos, sueño y pulso pasan a Salud y Road to Ironman los lee
        aquí, en el móvil: marcamos como hechos los entrenos que coincidan.
      </Text>
      <Text variant="caption" color="textMuted">
        Ojo: la VFC y el VO2máx de Garmin no llegan por Salud. Para eso usa la conexión de Garmin o pídele a tu Claude que
        los guarde.
        {isAiCoachEnabled() ? ' Si das permiso al Coach IA, un resumen de estas métricas se envía a Anthropic para planificar.' : ''}
      </Text>
      {!health.available ? (
        <Text variant="caption" color="textMuted">
          Disponible en la app del iPhone (no en la web ni en la demo del navegador).
        </Text>
      ) : health.enabled ? (
        <View style={styles.panel}>
          <Text variant="caption" color="textMuted">
            Última lectura: {formatRelativeTime(health.lastSync)}
          </Text>
          <View style={styles.actions}>
            <Button
              label="Sincronizar"
              icon="refresh"
              loading={health.busy}
              onPress={() => void run(() => health.syncNow(), 'No se pudo leer Salud.')}
            />
            <Button label="Desactivar" variant="danger" disabled={health.busy} onPress={() => void disable()} />
          </View>
        </View>
      ) : (
        <Button
          label="Conectar Apple Salud"
          icon="health"
          loading={health.busy}
          onPress={() => void run(() => health.connect(), 'No se pudo conectar con Salud.')}
        />
      )}
      {error ? <ErrorNotice message={error} /> : null}
    </IntegrationCard>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
