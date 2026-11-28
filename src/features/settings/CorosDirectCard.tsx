import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useDisconnectCoros, useIntegrations, useStartCorosConnect, useSyncCoros } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Loading, Text, haptics, space } from '@/ui';

import { confirmAction } from './confirm';
import { COROS_RETURN_URL, corosConnection, corosDirectView, corosReturnMessage } from './corosDirectModel';
import { formatRelativeTime } from './format';
import { IntegrationCard } from './IntegrationCard';

/**
 * COROS through the official COROS MCP: the athlete authorizes once on the COROS page and
 * the server syncs activities and wellness twice a day (and on demand). No Apple Salud, no Claude.
 */
export function CorosDirectCard({ returnUrl }: { returnUrl?: string | null }) {
  const { mode } = useAuth();
  const integrations = useIntegrations();
  const status = corosConnection(integrations.data);
  const view = corosDirectView(status);
  const start = useStartCorosConnect();
  const sync = useSyncCoros();
  const disconnect = useDisconnectCoros();
  const returned = corosReturnMessage(returnUrl);
  const [message, setMessage] = useState<string | null>(returned?.ok ? returned.message : null);
  const [error, setError] = useState<string | null>(returned && !returned.ok ? returned.message : null);

  const onConnect = async () => {
    setError(null);
    setMessage(null);
    try {
      const url = await start.mutateAsync();
      // Demo mode connects at once (no URL); otherwise COROS sends the athlete back to the app.
      if (mode !== 'demo' && url) {
        const result = await WebBrowser.openAuthSessionAsync(url, COROS_RETURN_URL);
        const back = result.type === 'success' ? corosReturnMessage(result.url) : null;
        await integrations.refetch();
        if (back && !back.ok) {
          haptics.warning();
          setError(back.message);
          return;
        }
        if (!back) return;
      }
      haptics.success();
      setMessage(mode === 'demo' ? 'Modo demo: COROS simulado como conectado.' : 'COROS conectado. Hemos traído tus últimas cuatro semanas.');
    } catch (err) {
      logger.warn('coros connect failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No hemos podido contactar con COROS.'));
    }
  };

  const onSync = async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await sync.mutateAsync();
      haptics.success();
      setMessage(result.message);
    } catch (err) {
      logger.warn('coros sync failed', err);
      setError(errorMessage(err, 'No se pudo sincronizar con COROS.'));
    }
  };

  const onDisconnect = async () => {
    const ok = await confirmAction({
      title: '¿Desconectar COROS?',
      message: 'Dejamos de traer tus datos de COROS y borramos el acceso del servidor. Lo ya importado se queda.',
      confirmLabel: 'Desconectar',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    setMessage(null);
    try {
      await disconnect.mutateAsync();
    } catch (err) {
      logger.warn('coros disconnect failed', err);
      setError(errorMessage(err, 'No se pudo desconectar COROS.'));
    }
  };

  return (
    <IntegrationCard icon="watch" title="COROS" badge="Conexión directa" status={{ tone: view.tone, label: view.label }}>
      <Text variant="callout" color="textMuted">
        Entras con tu cuenta de COROS una vez y traemos solos, dos veces al día, tus entrenos (con distancia, pulso y carga) y tu
        sueño, VFC, pulso en reposo y recuperación. Sin Apple Salud ni Claude.
      </Text>
      {integrations.isLoading ? (
        <Loading label="Comprobando conexión" />
      ) : integrations.isError ? (
        <ErrorNotice message={errorMessage(integrations.error)} onRetry={() => void integrations.refetch()} />
      ) : (
        <View style={styles.panel}>
          {view.detail ? (
            <Text variant="caption" color="textMuted">
              {view.detail}
            </Text>
          ) : null}
          {view.isConnected ? (
            <Text variant="caption" color="textMuted">
              {status?.lastSyncAt ? `Última sincronización: ${formatRelativeTime(status.lastSyncAt)}` : 'Aún sin sincronizar.'}
            </Text>
          ) : null}
          {view.canConnect ? (
            <Button
              label={view.isConnected ? 'Volver a conectar COROS' : 'Conectar con COROS'}
              icon="externalLink"
              size="lg"
              fullWidth
              loading={start.isPending}
              onPress={() => void onConnect()}
            />
          ) : null}
          {view.isConnected ? (
            <View style={styles.actions}>
              <Button label="Sincronizar" variant="secondary" icon="refresh" loading={sync.isPending} onPress={() => void onSync()} />
              <Button label="Desconectar" variant="danger" disabled={disconnect.isPending} onPress={() => void onDisconnect()} />
            </View>
          ) : null}
        </View>
      )}
      {message ? (
        <Text variant="callout" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      <Text variant="caption" color="textMuted">
        Datos de COROS a través de su conector oficial. COROS es una marca de COROS Wearables Inc.
      </Text>
    </IntegrationCard>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
