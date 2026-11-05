import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useWorkouts } from '@/data/queries';
import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { NotificationPrefs, Profile } from '@/domain/types';
import { useNotificationPermission } from '@/integrations/hooks';
import { rescheduleLocalNotifications } from '@/integrations/notifications';
import { logger } from '@/lib/logger';
import { Button, Card, Chip, Divider, ErrorNotice, Stepper, space } from '@/ui';

import { FormLabel } from './FormLabel';

import { clockToMinutes, minutesToClock } from './format';
import { PermissionRow, toPermissionState } from './PermissionRow';
import { SwitchRow } from './SwitchRow';
import { useProfileSave } from './useProfileSave';

const REMINDER_OPTIONS = [15, 30, 60] as const;
/** Switch-row icon tile (32) + gap (12) + inset (4): dividers start under the text. */
const ROW_INSET = 48;
const TIME_STEP_MIN = 15;
const LAST_SLOT_MIN = 24 * 60 - TIME_STEP_MIN;

function TimeStepper({ label, value, onChange }: { label: string; value: string; onChange: (time: string) => void }) {
  return (
    <Stepper
      label={label}
      value={clockToMinutes(value, 0)}
      step={TIME_STEP_MIN}
      min={0}
      max={LAST_SLOT_MIN}
      format={minutesToClock}
      onChange={(minutes) => onChange(minutesToClock(minutes))}
    />
  );
}

/** Notification preferences (stored in the profile) + local notification rescheduling. */
export function NotificationPrefsForm({ profile }: { profile: Profile }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(profile.notificationPrefs);
  const [warning, setWarning] = useState<string | null>(null);
  const permission = useNotificationPermission();
  const { save, saving, error } = useProfileSave();
  const today = todayISO();
  const weekStart = startOfWeek(today);
  const range = useMemo(() => ({ from: weekStart, to: addDays(weekStart, 13) }), [weekStart]);
  const workouts = useWorkouts(range);
  const set = (patch: Partial<NotificationPrefs>) => setPrefs((prev) => ({ ...prev, ...patch }));

  const onSave = async () => {
    setWarning(null);
    const updated = await save({ notificationPrefs: prefs });
    if (!updated) return;
    // Without loaded workouts we skip: AppEffects reschedules on the next foreground anyway.
    if (Platform.OS !== 'web' && workouts.data) {
      try {
        await rescheduleLocalNotifications({ workouts: workouts.data, profile: updated, today });
      } catch (err) {
        logger.warn('reschedule local notifications failed', err);
        setWarning('Guardado, pero no pudimos reprogramar los avisos de este móvil. Se reintentará al abrir la app.');
        return;
      }
    }
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={styles.wrap}>
      <Card padding={0} style={styles.card}>
        <PermissionRow
          icon="bell"
          title="Permiso del iPhone"
          description="Sin permiso no podemos avisarte, aunque actives las opciones de abajo."
          state={Platform.OS === 'web' ? 'unavailable' : toPermissionState(permission.status)}
          actionLabel="Permitir avisos"
          onRequest={() => permission.request()}
        />
      </Card>

      <Card padding={0} style={styles.card}>
        <SwitchRow
          icon="clock"
          title="Antes de cada entreno"
          subtitle="Un aviso con la sesión y la hora."
          value={prefs.workoutReminders}
          onChange={(workoutReminders) => set({ workoutReminders })}>
          <FormLabel>Con antelación</FormLabel>
          <View style={styles.chips}>
            {REMINDER_OPTIONS.map((min) => (
              <Chip
                key={min}
                label={min === 60 ? '1 h' : `${min} min`}
                selected={prefs.reminderMinutesBefore === min}
                onPress={() => set({ reminderMinutesBefore: min })}
              />
            ))}
          </View>
        </SwitchRow>
        <Divider inset={ROW_INSET} />
        <SwitchRow
          icon="today"
          title="Informe de cada mañana"
          subtitle="Qué toca hoy y cómo llegas (sueño, disposición)."
          value={prefs.morningSummary}
          onChange={(morningSummary) => set({ morningSummary })}>
          <TimeStepper label="Hora" value={prefs.morningTime} onChange={(morningTime) => set({ morningTime })} />
        </SwitchRow>
        <Divider inset={ROW_INSET} />
        <SwitchRow
          icon="moon"
          title="Check-in de la noche"
          subtitle="10 segundos: cómo has dormido, fatiga y molestias."
          value={prefs.eveningCheckin}
          onChange={(eveningCheckin) => set({ eveningCheckin })}>
          <TimeStepper label="Hora" value={prefs.eveningTime} onChange={(eveningTime) => set({ eveningTime })} />
        </SwitchRow>
        <Divider inset={ROW_INSET} />
        <SwitchRow
          icon="week"
          title="Planifica la semana"
          subtitle="El domingo por la tarde, para cuadrar la semana que viene."
          value={prefs.weeklyPlanReminder}
          onChange={(weeklyPlanReminder) => set({ weeklyPlanReminder })}
        />
        <Divider inset={ROW_INSET} />
        <SwitchRow
          icon="together"
          title="Amigos y quedadas"
          subtitle="Invitaciones, respuestas, kudos y entrenos de tus amigos."
          value={prefs.social}
          onChange={(social) => set({ social })}
        />
      </Card>

      {error ? <ErrorNotice message={error} /> : null}
      {warning ? <ErrorNotice message={warning} /> : null}
      <Button label="Guardar" size="lg" icon="check" fullWidth loading={saving} onPress={() => void onSave()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  card: { paddingHorizontal: space.md, paddingVertical: space.xs },
  chips: { flexDirection: 'row', gap: space.sm },
});
