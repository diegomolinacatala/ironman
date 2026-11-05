import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useIntegrations, useSyncGarmin, useTokens } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Icon, Loading, Text, haptics, iconSize, radius, space, useTheme, type IconName } from '@/ui';

import { StatusPill } from '../settings/StatusPill';
import {
  calendarConnectionView,
  calendarFeedConnectionView,
  claudeConnectionView,
  garminConnectionView,
  type ConnectionView,
} from './connectionsModel';
import { GroupDivider, ROW_DIVIDER_INSET, SettingsGroup } from './SettingsGroup';

/** Conexiones: Garmin, the training calendar, Claude and the calendar feed — live status and the one-tap fix. */
export function ConnectionsSection() {
  const integrations = useIntegrations();
  const tokens = useTokens();
  const calendar = useTrainingCalendar();
  const sync = useSyncGarmin();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (integrations.isLoading || tokens.isLoading) {
    return (
      <SettingsGroup title="Conexiones">
        <Loading label="Comprobando tus conexiones" />
      </SettingsGroup>
    );
  }

  const garmin = garminConnectionView(integrations.data?.find((i) => i.provider === 'garmin_personal'), todayISO());

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
    <SettingsGroup title="Conexiones">
      <ConnectionRow icon="watch" title="Garmin" view={garmin} href="/settings/integrations" busy={sync.isPending} onSync={() => void onSync()} />
      <GroupDivider />
      <ConnectionRow icon="calendarCheck" title="Calendario" view={calendarConnectionView(calendar)} href="/settings/integrations" />
      <GroupDivider />
      <ConnectionRow icon="sparkles" title="Claude" view={claudeConnectionView(tokens.data)} href="/settings/claude" />
      <GroupDivider />
      <ConnectionRow icon="link" title="Suscripción de calendario" view={calendarFeedConnectionView(tokens.data)} href="/settings/calendar-feed" />
      <ConnectionFeedback
        message={message}
        error={error}
        loadError={integrations.isError ? errorMessage(integrations.error) : null}
        onRetry={() => void integrations.refetch()}
      />
    </SettingsGroup>
  );
}

interface FeedbackProps {
  message: string | null;
  error: string | null;
  loadError: string | null;
  onRetry: () => void;
}

function ConnectionFeedback({ message, error, loadError, onRetry }: FeedbackProps) {
  if (!message && !error && !loadError) return null;
  return (
    <View style={styles.feedback}>
      {message ? (
        <Text variant="caption" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {loadError ? <ErrorNotice message={loadError} onRetry={onRetry} /> : null}
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
  const open = () => router.push(href);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${view.status}. ${view.detail ?? ''}`}
        accessibilityHint={`Abre los ajustes de ${title}`}
        onPress={() => {
          haptics.tap();
          open();
        }}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}>
        <View style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={icon} size={18} color={colors.textMuted} />
        </View>
        <View style={styles.text}>
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
        <Icon name="chevronRight" size={iconSize.sm - 2} color={colors.textMuted} />
      </Pressable>
      {action?.kind === 'sync' && onSync ? (
        <View style={styles.action}>
          <Button label={action.label} size="sm" variant="secondary" icon="refresh" loading={busy} onPress={onSync} />
        </View>
      ) : action?.kind === 'open' ? (
        <View style={styles.action}>
          <Button label={action.label} size="sm" variant={view.tone === 'danger' ? 'primary' : 'secondary'} onPress={open} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
  },
  tile: { width: 32, height: 32, borderRadius: radius.md - 2, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  action: { flexDirection: 'row', paddingLeft: ROW_DIVIDER_INSET, paddingBottom: space.md },
  feedback: { gap: space.sm, paddingHorizontal: space.xs, paddingBottom: space.md },
});
