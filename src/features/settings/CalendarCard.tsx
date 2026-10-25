import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useCalendarIntegration } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ErrorNotice, Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import { formatRelativeTime } from './format';
import { IntegrationCard } from './IntegrationCard';
import { toPermissionState } from './PermissionRow';
import { CALENDAR_PRIVACY_NOTE } from './privacyPolicy';

interface DeviceCalendar {
  id: string;
  title: string;
  color: string | null;
  source: string;
}

/** iPhone calendars (EventKit) read as busy blocks for planning and Huecos. */
export function CalendarCard() {
  const { colors } = useTheme();
  const calendar = useCalendarIntegration();
  const [error, setError] = useState<string | null>(null);
  const isWeb = Platform.OS === 'web';
  const permission = toPermissionState(calendar.permission);
  const status = isWeb
    ? { tone: 'muted' as const, label: 'Solo en iPhone' }
    : permission === 'granted'
      ? { tone: 'success' as const, label: `${calendar.selectedIds.length} calendario(s)` }
      : permission === 'denied'
        ? { tone: 'warning' as const, label: 'Sin permiso' }
        : { tone: 'muted' as const, label: 'Sin conectar' };

  const run = async (task: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await task();
    } catch (err) {
      logger.warn('calendar action failed', err);
      setError(errorMessage(err, fallback));
    }
  };

  const toggle = (id: string) => {
    const selected = calendar.selectedIds.includes(id)
      ? calendar.selectedIds.filter((x) => x !== id)
      : [...calendar.selectedIds, id];
    void run(() => calendar.setSelected(selected), 'No se pudo guardar la selección.');
  };

  return (
    <IntegrationCard icon="week" title="Calendario del iPhone" status={status}>
      <Text variant="callout" color="textMuted">
        Leemos tus clases, trabajo y planes para no plantarte un entreno encima y para encontrar huecos con tus amigos.
      </Text>
      <View style={styles.privacy}>
        <Icon name="lock" size={14} color={permission === 'granted' ? colors.success : colors.textFaint} />
        <Text variant="caption" color="textMuted" style={styles.flex}>
          {CALENDAR_PRIVACY_NOTE}
        </Text>
      </View>
      {isWeb ? (
        <Text variant="caption" color="textMuted">
          Disponible en la app del iPhone.
        </Text>
      ) : permission === 'granted' ? (
        <>
          <CalendarList calendars={calendar.calendars} selectedIds={calendar.selectedIds} onToggle={toggle} />
          <Text variant="caption" color="textMuted">
            Última sincronización: {formatRelativeTime(calendar.lastSync)}
          </Text>
          <Button
            label="Sincronizar"
            icon="refresh"
            loading={calendar.busy}
            disabled={calendar.selectedIds.length === 0}
            onPress={() => void run(() => calendar.syncNow(), 'No se pudo leer el calendario.')}
          />
        </>
      ) : permission === 'denied' ? (
        <Button
          label="Abrir Ajustes"
          variant="secondary"
          icon="settings"
          onPress={() => void run(() => Linking.openSettings(), 'No se pudo abrir Ajustes.')}
        />
      ) : (
        <Button
          label="Dar acceso al calendario"
          icon="week"
          loading={calendar.busy}
          onPress={() => void run(() => calendar.request(), 'No se pudo pedir el permiso.')}
        />
      )}
      {error ? <ErrorNotice message={error} /> : null}
    </IntegrationCard>
  );
}

interface CalendarListProps {
  calendars: readonly DeviceCalendar[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
}

function CalendarList({ calendars, selectedIds, onToggle }: CalendarListProps) {
  const { colors } = useTheme();
  if (calendars.length === 0) {
    return (
      <Text variant="caption" color="textMuted">
        No encontramos calendarios en este iPhone.
      </Text>
    );
  }
  return (
    <View style={[styles.list, { borderColor: colors.border }]}>
      {calendars.map((cal) => {
        const checked = selectedIds.includes(cal.id);
        return (
          <Pressable
            key={cal.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`${cal.title} (${cal.source})`}
            accessibilityState={{ checked }}
            onPress={() => {
              haptics.tap();
              onToggle(cal.id);
            }}
            style={({ pressed }) => [styles.calRow, pressed && { backgroundColor: colors.surfacePressed }]}>
            <View style={[styles.dot, { backgroundColor: cal.color ?? colors.textFaint }]} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {cal.title}
              </Text>
              <Text variant="caption" color="textMuted" numberOfLines={1}>
                {cal.source}
              </Text>
            </View>
            <View style={[styles.box, { borderColor: checked ? colors.text : colors.borderStrong, backgroundColor: checked ? colors.text : 'transparent' }]}>
              {checked ? <Icon name="check" size={12} color={colors.bg} weight="bold" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  privacy: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, minHeight: 52 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
