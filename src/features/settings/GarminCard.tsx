import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useDisconnectGarmin, useIntegrations, useSyncGarmin } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Icon, Loading, Text, haptics, space, useTheme } from '@/ui';

import { DEMO_GARMIN_KEY } from '../onboarding/connectModel';
import { GarminGuide, GarminPastePanel } from '../onboarding/garmin/GarminParts';
import { useGarminConnect, type GarminConnect } from '../onboarding/garmin/useGarminConnect';
import { WorkingState } from '../onboarding/GuideParts';
import { confirmAction } from './confirm';
import { formatRelativeTime } from './format';
import { garminStatusView } from './garminModel';
import { IntegrationCard } from './IntegrationCard';

/** Garmin Personal API (official, per-user key, synced server-side): same paste flow as the onboarding. */
export function GarminCard() {
  const { mode } = useAuth();
  const isDemo = mode === 'demo';
  const today = todayISO();
  const integrations = useIntegrations();
  const garmin = useGarminConnect({ isDemo, today });
  const view = garminStatusView(garmin.status, today);

  return (
    <IntegrationCard icon="watch" title="Garmin" badge="API oficial" status={view}>
      <Text variant="callout" color="textMuted">
        Con la “Personal API” oficial de Garmin traemos tus actividades, sueño, VFC y Body Battery. Solo tus datos, con tu
        propia clave, guardada cifrada en el servidor.
      </Text>
      {garmin.checking ? (
        <Loading label="Comprobando conexión" />
      ) : integrations.isError ? (
        <ErrorNotice message={errorMessage(integrations.error)} onRetry={() => void integrations.refetch()} />
      ) : (
        <>
          {view.detail ? <StatusDetail text={view.detail} warn={view.expiresSoon || view.tone === 'danger'} /> : null}
          <GarminFlow garmin={garmin} isDemo={isDemo} lastSyncAt={garmin.status?.lastSyncAt ?? null} />
        </>
      )}
      <Text variant="caption" color="textFaint">
        Datos de Garmin. Garmin y Garmin Connect son marcas de Garmin Ltd.
      </Text>
    </IntegrationCard>
  );
}

function GarminFlow({ garmin, isDemo, lastSyncAt }: { garmin: GarminConnect; isDemo: boolean; lastSyncAt: string | null }) {
  switch (garmin.phase) {
    case 'connected':
      return <ConnectedPanel lastSyncAt={lastSyncAt} onRenew={garmin.reconnect} />;
    case 'connecting':
      return <WorkingState title="Conectando con Garmin e importando tus datos…" />;
    case 'paste':
      return (
        <View style={styles.panel}>
          <GarminPastePanel garmin={garmin} showPasteControl />
          {isDemo ? (
            <Button label="Usar una clave de prueba (demo)" variant="ghost" onPress={() => void garmin.submit(DEMO_GARMIN_KEY)} />
          ) : (
            <Button label="Abrir Garmin otra vez" variant="ghost" icon="externalLink" onPress={() => void garmin.openGarmin()} />
          )}
        </View>
      );
    default:
      return (
        <View style={styles.panel}>
          <GarminGuide />
          {garmin.error ? <ErrorNotice message={garmin.error} /> : null}
          <Button label="Abrir Garmin Connect" icon="externalLink" size="lg" fullWidth onPress={() => void garmin.openGarmin()} />
          <Button label="Ya tengo la clave copiada" variant="ghost" onPress={garmin.showPaste} />
        </View>
      );
  }
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

function ConnectedPanel({ lastSyncAt, onRenew }: { lastSyncAt: string | null; onRenew: () => void }) {
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
      onRenew();
    } catch (err) {
      logger.warn('garmin disconnect failed', err);
      setError(errorMessage(err, 'No se pudo desconectar.'));
    }
  };

  return (
    <View style={styles.panel}>
      <Text variant="caption" color="textMuted">
        Última sincronización: {formatRelativeTime(lastSyncAt)} · se sincroniza sola cada mañana.
      </Text>
      {message ? (
        <Text variant="callout" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      <View style={styles.actions}>
        <Button label="Sincronizar ahora" icon="refresh" loading={sync.isPending} onPress={() => void onSync()} />
        <Button label="Usar otra clave" variant="secondary" icon="key" onPress={onRenew} />
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
