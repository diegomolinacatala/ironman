import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { getCalendarPermission } from '@/integrations/calendar';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { useCalendarIntegration } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, ErrorNotice, Text, space } from '@/ui';

import { CalendarList } from '../../settings/CalendarCard';
import { toPermissionState } from '../../settings/PermissionRow';
import { SwitchRow } from '../../settings/SwitchRow';
import { Appear } from '../Appear';
import { defaultReadCalendarIds } from '../calendarModel';
import { StatusLine } from '../GuideParts';
import { EventPreview } from '../PreviewCards';
import { StepLayout, type StepAction, type StepNav } from '../StepLayout';

/**
 * Step 5 (optional, iPhone only): we read busy time from the athlete's
 * calendars and write the workouts into our own calendar with an alarm.
 * Denied → explain Ajustes, may continue.
 */
export function CalendarStep({ nav }: { nav: StepNav }) {
  const calendar = useCalendarIntegration();
  const training = useTrainingCalendar();
  const [addWorkouts, setAddWorkouts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permission = toPermissionState(calendar.permission);

  useDefaultSelection(calendar);
  useRecheckOnReturn(permission === 'denied', calendar.request);

  const run = async (task: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      logger.warn('onboarding: calendar step failed', err);
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const allow = () =>
    run(async () => {
      await calendar.request();
      if (addWorkouts && (await getCalendarPermission()) === 'granted') await training.enable();
    }, 'No hemos podido pedir el permiso del calendario.');

  const finish = () =>
    run(async () => {
      if (addWorkouts && !training.enabled) await training.enable();
      if (!addWorkouts && training.enabled) await training.disable({ removeEvents: true });
      nav.next();
    }, 'No hemos podido preparar tu calendario. Puedes seguir y activarlo luego en Tú.');

  const primary: StepAction =
    permission === 'undetermined'
      ? { label: 'Permitir acceso al calendario', icon: 'calendarCheck', onPress: () => void allow(), loading: busy }
      : permission === 'denied'
        ? { label: 'Continuar sin calendario', iconRight: 'arrowRight', onPress: nav.next }
        : { label: 'Continuar', iconRight: 'arrowRight', onPress: () => void finish(), loading: busy };
  const secondary: StepAction | null = permission === 'undetermined' ? { label: 'Ahora no', onPress: nav.next, disabled: busy } : null;

  return (
    <StepLayout nav={nav} busy={busy} primary={primary} secondary={secondary}>
      <Appear index={1} style={styles.block}>
        <EventPreview alarmMinutes={training.alarmMinutes} />
        <StatusLine icon="eye" text="Leemos cuándo estás ocupado, nunca los títulos de tus eventos." />
      </Appear>
      <Appear index={2}>
        <Card padding="md">
          <SwitchRow
            icon="calendarPlus"
            title="Añadir mis entrenos al calendario"
            subtitle="En un calendario «Road to Ironman», con aviso antes de cada sesión."
            value={addWorkouts}
            onChange={setAddWorkouts}
          />
        </Card>
      </Appear>
      {permission === 'granted' ? (
        <Appear index={3} style={styles.block}>
          <Text variant="overline" color="textMuted">
            Calendarios que miro para no pisarte planes
          </Text>
          <CalendarList
            calendars={calendar.calendars}
            selectedIds={calendar.selectedIds}
            onToggle={(id) => {
              const next = calendar.selectedIds.includes(id) ? calendar.selectedIds.filter((x) => x !== id) : [...calendar.selectedIds, id];
              void calendar.setSelected(next).catch((err: unknown) => setError(errorMessage(err)));
            }}
          />
        </Appear>
      ) : null}
      {permission === 'denied' ? <DeniedCard /> : null}
      {training.error ? <ErrorNotice message={training.error} /> : null}
      {error ? <ErrorNotice message={error} /> : null}
    </StepLayout>
  );
}

function DeniedCard() {
  return (
    <Card variant="tinted" padding="lg">
      <View style={styles.block}>
        <Text variant="heading">Sin acceso al calendario</Text>
        <Text variant="callout" color="textMuted">
          Puedes darlo en Ajustes › Road to Ironman › Calendarios. Mientras, el plan usa solo tu disponibilidad.
        </Text>
        <Button label="Abrir Ajustes" icon="settings" variant="secondary" onPress={() => void Linking.openSettings()} />
      </View>
    </Card>
  );
}

/** Once access is granted, read every calendar except birthdays/holidays and our own. */
function useDefaultSelection(calendar: ReturnType<typeof useCalendarIntegration>): void {
  const done = useRef(false);
  const ready = calendar.permission === 'granted' && calendar.calendars.length > 0;
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    if (calendar.selectedIds.length > 0) return;
    const ids = defaultReadCalendarIds(calendar.calendars);
    if (ids.length > 0) void calendar.setSelected(ids).catch((err: unknown) => logger.warn('onboarding: default calendars failed', err));
  }, [ready, calendar]);
}

/** Back from iOS Settings: re-read the permission (no prompt once decided). */
function useRecheckOnReturn(enabled: boolean, recheck: () => Promise<void>): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void recheck().catch(() => undefined);
    });
    return () => sub.remove();
  }, [enabled, recheck]);
}

const styles = StyleSheet.create({
  block: { gap: space.md },
});
