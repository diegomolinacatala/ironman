import { StyleSheet, View } from 'react-native';

import { BrandMark } from '@/features/account/BrandMark';
import { Icon, Text, radius, space, useTheme } from '@/ui';

import { TRAINING_CALENDAR_TITLE, alarmLabel } from './calendarModel';

/** How a workout looks in the iPhone calendar (emoji only inside the event title, as in Calendar). */
export function EventPreview({ alarmMinutes = 30 }: { alarmMinutes?: number }) {
  const { colors, sport } = useTheme();
  const run = sport('run');
  return (
    <View
      accessible
      accessibilityLabel={`Ejemplo de evento: 07:30, Rodaje suave, 50 minutos, en el calendario ${TRAINING_CALENDAR_TITLE}, ${alarmLabel(alarmMinutes)}`}
      style={[styles.calendar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.hours}>
        <Text variant="caption" color="textMuted">
          07:00
        </Text>
        <Text variant="caption" color="textMuted" style={styles.hourGap}>
          08:00
        </Text>
      </View>
      <View style={[styles.event, { backgroundColor: run.tint, borderLeftColor: run.base }]}>
        <Text variant="bodyStrong" numberOfLines={1}>
          07:30 🏃 Rodaje suave · 50'
        </Text>
        <View style={styles.eventMeta}>
          <Icon name="bell" size={12} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {TRAINING_CALENDAR_TITLE} · {alarmLabel(alarmMinutes)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** The morning notification as it appears on the lock screen. */
export function NotificationPreview({ time }: { time: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Ejemplo de aviso a las ${time}: Informe de hoy. Has dormido 7 h 20 minutos. Hoy toca rodaje suave de 50 minutos.`}
      style={[styles.notification, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <BrandMark size={36} />
      <View style={styles.flex}>
        <View style={styles.notificationHead}>
          <Text variant="caption" color="textMuted" style={styles.flex}>
            Road to Ironman
          </Text>
          <Text variant="caption" color="textMuted">
            {time}
          </Text>
        </View>
        <Text variant="bodyStrong">Informe de hoy</Text>
        <Text variant="callout" color="textMuted">
          Has dormido 7 h 20' (bien). Hoy, rodaje suave de 50'. Púlsalo para escucharlo.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  calendar: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  hours: { width: 40, paddingTop: 2 },
  hourGap: { marginTop: space.xl },
  event: { flex: 1, borderLeftWidth: 4, borderRadius: radius.sm, padding: space.md, gap: 4, marginTop: space.md },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  notification: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  notificationHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
