import { router } from 'expo-router';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import type { ISOTime, Profile } from '@/domain/types';
import { TimeField } from '@/features/workouts/DateField';
import { useNotificationPermission } from '@/integrations/hooks';
import { Button, ErrorNotice, Icon, Text, iconSize, space, useTheme } from '@/ui';

import { MorningModeFields } from '../settings/MorningModeFields';
import { SwitchRow } from '../settings/SwitchRow';
import { morningSubtitle } from '../settings/wakeModel';
import { useMorningPrefs } from './useMorningPrefs';

/**
 * Morning report on/off, «Aviso del informe» (fixed time or when you wake up, with the
 * delay) and the time, as a row of the "Tu coach" group: optimistic, time debounced, saves
 * serialized (see `useMorningPrefs`). The usual wake-up window lives in Notificaciones.
 */
export function MorningSection({ profile }: { profile: Profile }) {
  const notifications = useNotificationPermission();
  const { prefs, error, setEnabled, setTime, setWake } = useMorningPrefs(profile);
  const denied = Platform.OS !== 'web' && notifications.status === 'denied';

  const toggle = async (on: boolean) => {
    await setEnabled(on);
    if (on && Platform.OS !== 'web' && notifications.status === 'undetermined') await notifications.request();
  };

  return (
    <View>
      <SwitchRow
        icon="sunrise"
        title="Informe de cada mañana"
        subtitle={prefs.morningSummary ? morningSubtitle(prefs) : 'Cómo has dormido y qué toca hoy, en un aviso.'}
        value={prefs.morningSummary}
        onChange={(on) => void toggle(on)}>
        <MorningModeFields
          prefs={prefs}
          onChange={(patch) => void setWake(patch)}
          timeControl={
            <TimeField
              label="Hora del informe"
              value={prefs.morningTime}
              optional={false}
              onChange={(time: ISOTime | null) => {
                if (time && time !== prefs.morningTime) setTime(time);
              }}
            />
          }
        />
        {prefs.morningMode === 'wake' ? (
          <Button
            label="Tu franja de despertar"
            variant="ghost"
            size="sm"
            icon="clock"
            onPress={() => router.push('/settings/notifications')}
            accessibilityHint="Abre Notificaciones: tu franja habitual y cuándo llega si el reloj no dice nada"
          />
        ) : null}
      </SwitchRow>
      {denied && prefs.morningSummary ? <DeniedNotice /> : null}
      {error ? (
        <View style={styles.notice}>
          <ErrorNotice message={error} />
        </View>
      ) : null}
    </View>
  );
}

function DeniedNotice() {
  const { colors } = useTheme();
  return (
    <View style={[styles.notice, styles.denied]}>
      <Icon name="warning" size={iconSize.sm} color={colors.warning} />
      <Text variant="caption" style={[styles.flex, { color: colors.text }]}>
        Los avisos están desactivados en Ajustes: no te llegará el informe.
      </Text>
      <Button label="Abrir Ajustes" size="sm" variant="secondary" onPress={() => void Linking.openSettings()} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { paddingHorizontal: space.xs, paddingBottom: space.md },
  denied: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
