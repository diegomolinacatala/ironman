import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, ErrorNotice, Icon, Text, haptics, iconSize, radius, space, useTheme, type IconName } from '@/ui';

import { StatusPill } from '../settings/StatusPill';
import type { ConnectionView } from './connectionsModel';
import { ROW_DIVIDER_INSET } from './SettingsGroup';

export interface ConnectionRowProps {
  icon: IconName;
  title: string;
  view: ConnectionView;
  href: string;
  busy?: boolean;
  onSync?: () => void;
}

/** One connection in Tú › Conexiones: status pill, one line and the one-tap fix under it. */
export function ConnectionRow({ icon, title, view, href, busy = false, onSync }: ConnectionRowProps) {
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

export interface ConnectionFeedbackProps {
  message: string | null;
  error: string | null;
  /** Neutral information (e.g. "Aún no vemos datos de COROS…"). */
  note?: string | null;
  loadError?: string | null;
  onRetry?: () => void;
}

/** Result of a one-tap sync (or a load error with retry), under the rows. */
export function ConnectionFeedback({ message, error, note = null, loadError = null, onRetry }: ConnectionFeedbackProps) {
  if (!message && !error && !note && !loadError) return null;
  return (
    <View style={styles.feedback}>
      {message ? (
        <Text variant="caption" color="success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {note ? (
        <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
      {loadError ? <ErrorNotice message={loadError} onRetry={onRetry} /> : null}
      {error ? <ErrorNotice message={error} /> : null}
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
