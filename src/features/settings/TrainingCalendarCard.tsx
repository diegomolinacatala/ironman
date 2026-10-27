import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Chip, ErrorNotice, Text, haptics, space } from '@/ui';

import { ALARM_OPTIONS, alarmLabel } from '../onboarding/calendarModel';
import { EventPreview } from '../onboarding/PreviewCards';
import { confirmAction } from './confirm';
import { formatRelativeTime } from './format';
import type { StatusTone } from './garminModel';
import { IntegrationCard } from './IntegrationCard';
import { SwitchRow } from './SwitchRow';

function statusOf(calendar: ReturnType<typeof useTrainingCalendar>): { tone: StatusTone; label: string } {
  if (!calendar.available) return { tone: 'muted', label: 'Solo en iPhone' };
  if (calendar.enabled) return { tone: 'success', label: 'Activado' };
  if (calendar.permission === 'denied') return { tone: 'warning', label: 'Sin permiso' };
  return { tone: 'muted', label: 'Desactivado' };
}

/** "Tus entrenos en el calendario": we WRITE planned workouts to our own calendar, with an alarm. */
export function TrainingCalendarCard() {
  const calendar = useTrainingCalendar();
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await task();
      haptics.success();
    } catch (err) {
      logger.warn('training calendar action failed', err);
      setError(errorMessage(err, fallback));
    }
  };

  const toggle = async (on: boolean) => {
    if (on) {
      return run(async () => {
        if (!(await calendar.enable())) throw new Error('Sin permiso para usar el calendario: actívalo en Ajustes › Road to Ironman.');
      }, 'No se pudo activar. Inténtalo de nuevo.');
    }
    const ok = await confirmAction({
      title: '¿Dejar de añadir tus entrenos?',
      message: 'Quitaremos tus entrenos del calendario «Road to Ironman». El plan sigue en la app.',
      confirmLabel: 'Quitar',
      destructive: true,
    });
    if (ok) await run(() => calendar.disable({ removeEvents: true }), 'No se pudo desactivar. Inténtalo de nuevo.');
    return undefined;
  };

  return (
    <IntegrationCard icon="calendarPlus" title="Tus entrenos en el calendario" status={statusOf(calendar)}>
      <Text variant="callout" color="textMuted">
        Apuntamos cada entreno de las próximas 3 semanas en un calendario «Road to Ironman», con aviso antes. Si el plan
        cambia, el calendario también.
      </Text>
      <EventPreview alarmMinutes={calendar.alarmMinutes} />
      {!calendar.available ? (
        <Text variant="caption" color="textMuted">
          Disponible en la app del iPhone.
        </Text>
      ) : (
        <>
          <SwitchRow
            icon="calendarCheck"
            title="Añadir mis entrenos al calendario"
            subtitle={calendar.enabled ? `Con ${alarmLabel(calendar.alarmMinutes)}.` : 'Desactivado.'}
            value={calendar.enabled}
            disabled={calendar.busy}
            onChange={(on) => void toggle(on)}>
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Aviso antes de cada entreno
              </Text>
              <View style={styles.chips}>
                {ALARM_OPTIONS.map((option) => (
                  <Chip
                    key={option.minutes}
                    label={option.label}
                    selected={calendar.alarmMinutes === option.minutes}
                    disabled={calendar.busy}
                    onPress={() => void run(() => calendar.setAlarmMinutes(option.minutes), 'No se pudo cambiar el aviso.')}
                  />
                ))}
              </View>
              <Text variant="caption" color="textMuted">
                Última sincronización: {formatRelativeTime(calendar.lastSync)}
              </Text>
              <Button
                label="Sincronizar ahora"
                icon="refresh"
                variant="secondary"
                loading={calendar.busy}
                onPress={() => void run(() => calendar.syncNow(), 'No se pudo sincronizar el calendario.')}
              />
            </View>
          </SwitchRow>
          {calendar.permission === 'denied' && !calendar.enabled ? (
            <Button label="Abrir Ajustes" variant="secondary" icon="settings" onPress={() => void Linking.openSettings()} />
          ) : null}
        </>
      )}
      {calendar.error ? <ErrorNotice message={calendar.error} /> : null}
      {error ? <ErrorNotice message={error} /> : null}
    </IntegrationCard>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
