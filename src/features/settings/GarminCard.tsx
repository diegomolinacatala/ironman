import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useDisconnectGarmin, useIntegrations, useSyncGarmin } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Icon, Loading, Text, haptics, space, useTheme } from '@/ui';

import { DemoBanner } from '../account/DemoBanner';
import { confirmAction } from './confirm';
import { formatRelativeTime } from './format';
import { GarminConnectForm } from './GarminConnectForm';
import { garminStatusView } from './garminModel';
import { IntegrationCard } from './IntegrationCard';

/** Garmin Personal API (official, per-user key, synced server-side). */
export function GarminCard() {
  const { mode } = useAuth();
  const integrations = useIntegrations();
  const today = todayISO();
  const status = integrations.data?.find((i) => i.provider === 'garmin_personal');
  const view = garminStatusView(status, today);
  const isDemo = mode === 'demo';

  return (
    <IntegrationCard
      icon="watch"
      title="Garmin"
      badge="Beta · API oficial"
      status={isDemo ? { tone: 'muted', label: 'No disponible en demo' } : view}>
      <Text variant="callout" color="textMuted">
        Con la “Personal API” oficial de Garmin traemos tus actividades, sueño, VFC y Body Battery. Solo tus datos, con tu
        propia clave, guardada cifrada en el servidor.
      </Text>
      {isDemo ? (
        <DemoBanner message="En modo demo no hay servidor, así que no se puede conectar Garmin. Configura el backend (Supabase) para usarlo." />
      ) : integrations.isLoading ? (
        <Loading label="Comprobando conexión" />
      ) : integrations.isError ? (
        <ErrorNotice message={errorMessage(integrations.error)} onRetry={() => void integrations.refetch()} />
      ) : (
        <>
          {view.detail ? <StatusDetail text={view.detail} warn={view.expiresSoon || view.tone === 'danger'} /> : null}
          {view.isConnected ? <ConnectedPanel lastSyncAt={status?.lastSyncAt ?? null} /> : null}
          {view.needsKey ? <GarminConnectForm today={today} /> : null}
        </>
      )}
      <Text variant="caption" color="textFaint">
        Datos de Garmin. Garmin y Garmin Connect son marcas de Garmin Ltd.
      </Text>
    </IntegrationCard>
  );
}

function StatusDetail({ text, warn }: { text: string; warn: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.detail}>
      <Icon name={warn ? 'warning' : 'info'} size={14} color={warn ? colors.warning : colors.textMuted} />
      <Text variant="caption" style={{ flex: 1, color: warn ? colors.text : colors.textMuted }}>
        {text}
      </Text>
    </View>
  );
}

function ConnectedPanel({ lastSyncAt }: { lastSyncAt: string | null }) {
  const sync = useSyncGarmin();
  const disconnect = useDisconnectGarmin();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSync = async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await sync.mutateAsync();
      haptics.success();
      setMessage(result.message);
    } catch (err) {
      logger.warn('garmin sync failed', err);
      setError(errorMessage(err, 'No se pudo sincronizar con Garmin.'));
    }
  };

  const onDisconnect = async () => {
    const ok = await confirmAction({
      title: '¿Desconectar Garmin?',
      message: 'Borramos tu clave del servidor. Los datos ya importados se quedan. Puedes volver a conectar cuando quieras.',
      confirmLabel: 'Desconectar',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await disconnect.mutateAsync();
      setMessage(null);
    } catch (err) {
      logger.warn('garmin disconnect failed', err);
      setError(errorMessage(err, 'No se pudo desconectar.'));
    }
  };

  return (
    <View style={styles.panel}>
      <Text variant="caption" color="textMuted">
        Última sincronización: {formatRelativeTime(lastSyncAt)} · se sincroniza sola a las 6:30 y 9:30.
      </Text>
      {message ? (
        <Text variant="callout" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      <View style={styles.actions}>
        <Button label="Sincronizar ahora" icon="refresh" loading={sync.isPending} onPress={() => void onSync()} />
        <Button label="Desconectar" variant="danger" loading={disconnect.isPending} onPress={() => void onDisconnect()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  panel: { gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
