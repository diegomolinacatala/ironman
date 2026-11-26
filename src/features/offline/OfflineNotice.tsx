import { StyleSheet, View } from 'react-native';

import { usePendingOffline } from '@/data/offline/offlineQueue';
import { requestOfflineFlush } from '@/data/offline/useOfflineSync';
import { Button, Icon, Text, iconSize, radius, space, useTheme } from '@/ui';

export const OFFLINE_NOTICE_TEXT = 'Guardado en el móvil: se enviará cuando vuelva la conexión.';

export interface OfflineNoticeProps {
  /** Only for this change (`checkinKey(date)`, `completeKey(id)`); by default, for anything waiting. */
  pendingKey?: string;
}

/**
 * Calm line while a check-in or a «Hecho» waits on the phone for the connection
 * (`data/offline`). It goes away by itself once sent; «Reintentar» tries now.
 */
export function OfflineNotice({ pendingKey }: OfflineNoticeProps) {
  const { colors } = useTheme();
  const items = usePendingOffline();
  const waiting = pendingKey ? items.some((item) => item.key === pendingKey) : items.length > 0;
  if (!waiting) return null;
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]}>
      <View style={styles.row} accessible accessibilityLabel={OFFLINE_NOTICE_TEXT} accessibilityLiveRegion="polite">
        <Icon name="phone" size={iconSize.sm} color={colors.textMuted} />
        <Text variant="callout" color="textMuted" style={styles.text}>
          {OFFLINE_NOTICE_TEXT}
        </Text>
      </View>
      <Button label="Reintentar" icon="refresh" variant="ghost" size="sm" onPress={requestOfflineFlush} style={styles.retry} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingTop: space.xs },
  text: { flex: 1 },
  retry: { alignSelf: 'flex-start' },
});
