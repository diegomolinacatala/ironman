import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FIRST_HEALTH_IMPORT_DAYS, useHealthIntegration, type HealthIntegration, type HealthSyncResult } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Icon, Loading, Text, haptics, space, useTheme } from '@/ui';

import { NumberedSteps } from '../onboarding/GuideParts';
import { confirmAction } from './confirm';
import { COROS_HEALTH_STEPS, COROS_PERMISSION_CHECKS } from './corosContent';
import { openCorosApp, openCorosGuide } from './corosLinks';
import { corosImportView, corosStatusView, type CorosStatusView } from './corosModel';
import { IntegrationCard } from './IntegrationCard';

/**
 * COROS has no personal API: the COROS app writes workouts, sleep and pulse to
 * Apple Salud and we read them on this iPhone. HRV, recovery and load come
 * through the athlete's Claude (see the guide).
 */
export function CorosCard() {
  const health = useHealthIntegration();
  const view = corosStatusView(health);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<HealthSyncResult | null>, fallback: string) => {
    setError(null);
    setMessage(null);
    try {
      const result = await task();
      haptics.success();
      setMessage(result ? corosImportView(result, health.sources).message : 'Apple Salud conectado. Tus datos llegarán en unos minutos.');
    } catch (err) {
      logger.warn('coros: card action failed', err);
      haptics.warning();
      setError(errorMessage(err, fallback));
    }
  };

  return (
    <IntegrationCard icon="watch" title="COROS" badge="Por Apple Salud" status={{ tone: view.tone, label: view.label }}>
      <Text variant="callout" color="textMuted">
        La app COROS pasa a Apple Salud tus entrenos, tu sueño y tu pulso, y Road to Ironman los lee aquí, en el iPhone. La VFC,
        la recuperación y la carga llegan con tu Claude.
      </Text>
      <CorosBody
        view={view}
        health={health}
        onConnect={() => void run(() => health.connect({ days: FIRST_HEALTH_IMPORT_DAYS }), 'No se pudo conectar con Salud.')}
        onSync={() => void run(() => health.syncNow({ days: FIRST_HEALTH_IMPORT_DAYS }), 'No se pudo leer Salud.')}
        onError={setError}
      />
      {message ? (
        <Text variant="callout" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      <Button label="Guía paso a paso" variant="ghost" icon="info" onPress={openCorosGuide} />
    </IntegrationCard>
  );
}

interface CorosBodyProps {
  view: CorosStatusView;
  health: HealthIntegration;
  onConnect: () => void;
  onSync: () => void;
  onError: (message: string) => void;
}

function CorosBody({ view, health, onConnect, onSync, onError }: CorosBodyProps) {
  switch (view.state) {
    case 'unavailable':
      return (
        <Text variant="caption" color="textMuted">
          Disponible en la app del iPhone (no en la web ni en la demo del navegador).
        </Text>
      );
    case 'checking':
      return <Loading label="Comprobando Apple Salud" />;
    case 'off':
      return (
        <View style={styles.panel}>
          <NumberedSteps items={COROS_HEALTH_STEPS} />
          <Button label="Conectar Apple Salud" icon="health" size="lg" fullWidth loading={health.busy} onPress={onConnect} />
          <Button label="Abrir la app COROS" variant="ghost" icon="externalLink" onPress={() => void openCorosApp()} />
        </View>
      );
    default:
      return <ConnectedPanel view={view} health={health} onSync={onSync} onError={onError} />;
  }
}

function ConnectedPanel({ view, health, onSync, onError }: Omit<CorosBodyProps, 'onConnect'>) {
  const waiting = view.state === 'waiting';
  const disable = async () => {
    const ok = await confirmAction({
      title: '¿Desactivar Apple Salud?',
      message: 'Dejaremos de leer tu COROS en Salud. Para quitar el permiso del todo: Ajustes › Salud › Acceso a datos › Road to Ironman.',
      confirmLabel: 'Desactivar',
      destructive: true,
    });
    if (!ok) return;
    await health.disable().catch((err: unknown) => {
      logger.warn('coros: disable failed', err);
      onError(errorMessage(err, 'No se pudo desactivar.'));
    });
  };
  return (
    <View style={styles.panel}>
      {waiting ? <WaitingHint /> : <Text variant="caption" color="textMuted">{view.detail}</Text>}
      <View style={styles.actions}>
        <Button label="Sincronizar" variant="secondary" icon="refresh" loading={health.busy} onPress={onSync} />
        {waiting ? <Button label="Abrir la app COROS" variant="secondary" icon="externalLink" onPress={() => void openCorosApp()} /> : null}
        <Button label="Desactivar" variant="danger" disabled={health.busy} onPress={() => void disable()} />
      </View>
    </View>
  );
}

/** Apple Salud on, nothing from COROS yet: what to do and where the permissions live. */
function WaitingHint() {
  const { colors } = useTheme();
  return (
    <View style={styles.panel}>
      <View style={styles.detail}>
        <Icon name="warning" size={14} color={colors.warning} />
        <Text variant="caption" style={[styles.flex, { color: colors.text }]}>
          Aún no vemos datos de COROS. Abre la app COROS con el reloj cerca y vuelve a sincronizar.
        </Text>
      </View>
      {COROS_PERMISSION_CHECKS.map((line) => (
        <Text key={line} variant="caption" color="textMuted">
          {`· ${line}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  detail: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
