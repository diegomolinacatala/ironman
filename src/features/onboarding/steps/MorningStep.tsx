import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { useUpdateProfile } from '@/data/queries';
import type { ISOTime, Profile } from '@/domain/types';
import { TimeField } from '@/features/workouts/DateField';
import { useNotificationPermission } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { ErrorNotice, Text, haptics, space } from '@/ui';

import { Appear } from '../Appear';
import { NumberedSteps, type GuideItem } from '../GuideParts';
import { DEFAULT_MORNING_TIME } from '../onboardingModel';
import { NotificationPreview } from '../PreviewCards';
import { StepLayout, type StepNav } from '../StepLayout';

const WIDGET_GUIDE: readonly GuideItem[] = [
  { icon: 'lock', text: 'Mantén pulsada la pantalla de bloqueo', detail: 'Y toca «Personalizar».' },
  { icon: 'add', text: 'Toca «Añadir widgets»' },
  { icon: 'sunrise', text: 'Elige Road to Ironman · Informe de hoy', detail: 'Verás el resumen sin desbloquear el móvil.' },
];

export function initialMorningTime(profile: Profile): ISOTime {
  const prefs = profile.notificationPrefs;
  return prefs?.morningSummary && prefs.morningTime ? prefs.morningTime : DEFAULT_MORNING_TIME;
}

/**
 * Step 6 (optional, iPhone only): the time of the morning report, the
 * notification permission and how to add the lock-screen widget.
 */
export function MorningStep({ nav, profile }: { nav: StepNav; profile: Profile }) {
  const update = useUpdateProfile();
  const notifications = useNotificationPermission();
  const [time, setTime] = useState<ISOTime>(() => initialMorningTime(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setSaving(true);
    setError(null);
    try {
      await update.mutateAsync({ notificationPrefs: { ...profile.notificationPrefs, morningSummary: true, morningTime: time } });
      // Saved even if the permission is denied: the widget still works and Tú explains how to allow it.
      if (Platform.OS !== 'web' && notifications.status !== 'granted') await notifications.request();
      haptics.success();
      nav.next();
    } catch (err) {
      logger.warn('onboarding: morning report failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No hemos podido guardar la hora. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepLayout
      nav={nav}
      busy={saving}
      primary={{ label: 'Activar mi informe', icon: 'bell', onPress: () => void activate(), loading: saving }}
      secondary={{ label: 'Ahora no', onPress: nav.next, disabled: saving }}>
      <Appear index={1} style={styles.block}>
        <TimeField label="¿A qué hora te despiertas?" value={time} optional={false} onChange={(next) => setTime(next ?? DEFAULT_MORNING_TIME)} />
        <NotificationPreview time={time} />
      </Appear>
      {notifications.status === 'denied' ? (
        <Text variant="caption" color="warning">
          Tienes los avisos desactivados en Ajustes › Road to Ironman. El widget funcionará igualmente.
        </Text>
      ) : null}
      <Appear index={2} style={styles.block}>
        <Text variant="overline" color="textMuted">
          Ponlo en tu pantalla de bloqueo
        </Text>
        <NumberedSteps items={WIDGET_GUIDE} startIndex={3} />
      </Appear>
      {error ? <ErrorNotice message={error} /> : null}
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
});
