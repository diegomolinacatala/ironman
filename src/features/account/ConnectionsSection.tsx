import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useIntegrations, useSyncGarmin, useTokens } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, Divider, ErrorNotice, Icon, IconButton, Loading, Text, haptics, radius, space, useTheme, type IconName } from '@/ui';

import { StatusPill } from '../settings/StatusPill';
import {
  calendarConnectionView,
  claudeConnectionView,
  garminConnectionView,
  type ConnectionView,
} from './connectionsModel';

/** Garmin, Claude and the training calendar: live status and the one-tap fix for each. */
export function ConnectionsSection() {
  const integrations = useIntegrations();
  const tokens = useTokens();
  const calendar = useTrainingCalendar();
  const sync = useSyncGarmin();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (integrations.isLoading || tokens.isLoading) return <Loading label="Comprobando tus conexiones" />;

  const garmin = garminConnectionView(integrations.data?.find((i) => i.provider === 'garmin_personal'), todayISO());
  const claude = claudeConnectionView(tokens.data);
  const cal = calendarConnectionView(calendar);

  const onSync = async () => {
    setError(null);
    setMessage(null);
    try {
      await sync.mutateAsync();
      haptics.success();
      setMessage('Garmin sincronizado.');
    } catch (err) {
      logger.warn('tú: garmin sync failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No se pudo sincronizar con Garmin.'));
    }
  };

  return (
    <View style={styles.wrap}>
      <Card padding="md">
        <ConnectionRow icon="watch" title="Garmin" view={garmin} href="/settings/integrations" busy={sync.isPending} onSync={() => void onSync()} />
        <Divider inset={56} />
        <ConnectionRow icon="sparkles" title="Claude" view={claude} href="/settings/claude" />
        <Divider inset={56} />
        <ConnectionRow icon="calendarCheck" title="Calendario" view={cal} href="/settings/integrations" />
      </Card>
      {message ? (
        <Text variant="caption" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {integrations.isError ? <ErrorNotice message={errorMessage(integrations.error)} onRetry={() => void integrations.refetch()} /> : null}
      {error ? <ErrorNotice message={error} /> : null}
    </View>
  );
}

interface ConnectionRowProps {
  icon: IconName;
  title: string;
  view: ConnectionView;
  href: string;
  busy?: boolean;
  onSync?: () => void;
}

function ConnectionRow({ icon, title, view, href, busy = false, onSync }: ConnectionRowProps) {
  const { colors } = useTheme();
  const action = view.action;
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={20} color={colors.text} />
      </View>
      <View style={styles.body}>
        <View style={styles.text} accessible accessibilityLabel={`${title}: ${view.status}. ${view.detail ?? ''}`}>
          <View style={styles.titleRow}>
            <Text variant="bodyStrong">{title}</Text>
            <StatusPill tone={view.tone} label={view.status} />
          </View>
          {view.detail ? (
            <Text variant="caption" color="textMuted">
              {view.detail}
            </Text>
          ) : null}
        </View>
        {action?.kind === 'sync' && onSync ? (
          <View style={styles.action}>
            <Button label={action.label} size="sm" variant="secondary" icon="refresh" loading={busy} onPress={onSync} />
          </View>
        ) : action?.kind === 'open' ? (
          <View style={styles.action}>
            <Button label={action.label} size="sm" variant={view.tone === 'danger' ? 'primary' : 'secondary'} onPress={() => router.push(href)} />
          </View>
        ) : null}
      </View>
      <IconButton icon="chevronRight" size={44} accessibilityLabel={`Ajustes de ${title}`} onPress={() => router.push(href)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: space.md },
  body: { flex: 1, gap: space.sm },
  action: { flexDirection: 'row' },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: space.xs },
  text: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
});
