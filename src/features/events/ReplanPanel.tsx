import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatDayLabel, formatTime, todayISO } from '@/domain/dates';
import type { LifeEvent } from '@/domain/types';
import { Button, Card, Icon, Text, space, useTheme } from '@/ui';

import { closeModal } from '@/features/workouts/ModalClose';

import { lifeEventIcon } from './kinds';
import { useReplanForEvent } from './useReplanForEvent';

function eventWhen(e: LifeEvent): string {
  const today = todayISO();
  const start = formatDayLabel(e.startDate, today);
  if (e.endDate && e.endDate !== e.startDate) return `${start} – ${formatDayLabel(e.endDate, today)}`;
  const time = formatTime(e.startTime);
  return time ? `${start} · ${time}` : start;
}

/** Post-save panel: "¿Reorganizamos tu semana?" with rules / AI / no options. */
export function ReplanPanel({ event }: { event: LifeEvent }) {
  const { colors } = useTheme();
  const replan = useReplanForEvent(event);
  return (
    <View style={styles.root}>
      <Card variant="inverse" padding="lg" style={styles.saved}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.accent }]}>
            <Icon name={lifeEventIcon(event.kind)} size={22} color={colors.onAccent} />
          </View>
          <View style={styles.flex}>
            <Text variant="overline" style={{ color: colors.inverseText, opacity: 0.7 }}>
              Imprevisto guardado
            </Text>
            <Text variant="heading" style={{ color: colors.inverseText }}>
              {event.title}
            </Text>
            <Text variant="caption" style={{ color: colors.inverseText, opacity: 0.7 }}>
              {eventWhen(event)}
            </Text>
          </View>
        </View>
      </Card>

      <Text variant="title" accessibilityRole="header">
        ¿Reorganizamos tu semana?
      </Text>
      <Text variant="callout" color="textMuted">
        Te propondremos cambios que podrás aceptar uno a uno. Las quedadas y las sesiones clave se respetan.
      </Text>
      {replan.message ? (
        <Card variant="tinted" padding="md">
          <Text variant="callout">{replan.message}</Text>
        </Card>
      ) : null}
      <Button
        label="Reorganizar (reglas)"
        icon="sparkles"
        size="lg"
        fullWidth
        onPress={() => void replan.run()}
        loading={replan.busy}
        disabled={!replan.ready}
        accessibilityHint="Propuesta instantánea con el motor de reglas, sin conexión"
      />
      <Button
        label="Pedir al coach IA"
        icon="coach"
        variant="secondary"
        size="lg"
        fullWidth
        onPress={() => router.replace(`/coach?mode=replan&lifeEventId=${event.id}`)}
      />
      <Button label="No, gracias" variant="ghost" fullWidth onPress={closeModal} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  saved: { marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
});
