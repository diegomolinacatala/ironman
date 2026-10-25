import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { errorMessage, logger } from '@/lib/logger';
import { Button, Icon, Text, radius, space, useTheme, type IconName } from '@/ui';

import { StatusPill } from './StatusPill';
import type { StatusTone } from './garminModel';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

const STATUS: Record<PermissionState, { tone: StatusTone; label: string }> = {
  granted: { tone: 'success', label: 'Activado' },
  denied: { tone: 'warning', label: 'Denegado' },
  undetermined: { tone: 'muted', label: 'Sin activar' },
  unavailable: { tone: 'muted', label: 'Solo en iPhone' },
};

/** Narrows a hook's permission value to a PermissionState. */
export function toPermissionState(value: unknown): PermissionState {
  return value === 'granted' || value === 'denied' || value === 'undetermined' ? value : 'undetermined';
}

export interface PermissionRowProps {
  icon: IconName;
  title: string;
  description: string;
  state: PermissionState;
  actionLabel: string;
  onRequest: () => Promise<unknown>;
}

/** Explains one permission, shows its status and asks for it. Denied → opens iOS Settings. */
export function PermissionRow({ icon, title, description, state, actionLabel, onRequest }: PermissionRowProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      if (state === 'denied') await Linking.openSettings();
      else await onRequest();
    } catch (err) {
      logger.warn(`permission request failed: ${title}`, err);
      setError(errorMessage(err, 'No se pudo pedir el permiso.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={20} color={colors.text} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" style={styles.flex}>
            {title}
          </Text>
          <StatusPill tone={STATUS[state].tone} label={STATUS[state].label} />
        </View>
        <Text variant="caption" color="textMuted">
          {description}
        </Text>
        {state === 'granted' || state === 'unavailable' ? null : (
          <Button
            label={state === 'denied' ? 'Abrir Ajustes' : actionLabel}
            variant="secondary"
            size="sm"
            loading={busy}
            onPress={() => void request()}
            style={styles.button}
          />
        )}
        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  button: { alignSelf: 'flex-start', marginTop: space.xs, minHeight: 44 },
});
