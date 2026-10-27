import { Linking, Platform, StyleSheet, View } from 'react-native';

import type { ISOTime, Profile } from '@/domain/types';
import { TimeField } from '@/features/workouts/DateField';
import { useNotificationPermission } from '@/integrations/hooks';
import { Button, Card, ErrorNotice, Text, space } from '@/ui';

import { SwitchRow } from '../settings/SwitchRow';
import { useMorningPrefs } from './useMorningPrefs';

/** Morning report on/off + time: optimistic, time debounced, saves serialized (see `useMorningPrefs`). */
export function MorningSection({ profile }: { profile: Profile }) {
  const notifications = useNotificationPermission();
  const { prefs, error, setEnabled, setTime } = useMorningPrefs(profile);
  const denied = Platform.OS !== 'web' && notifications.status === 'denied';

  const toggle = async (on: boolean) => {
    await setEnabled(on);
    if (on && Platform.OS !== 'web' && notifications.status === 'undetermined') await notifications.request();
  };

  return (
    <View style={styles.wrap}>
      <Card padding="md">
        <SwitchRow
          icon="sunrise"
          title="Informe de cada mañana"
          subtitle={prefs.morningSummary ? `Cada día a las ${prefs.morningTime}: cómo has dormido y qué toca.` : 'Cómo has dormido y qué toca hoy, en un aviso.'}
          value={prefs.morningSummary}
          onChange={(on) => void toggle(on)}>
          <TimeField
            label="Hora del informe"
            value={prefs.morningTime}
            optional={false}
            onChange={(time: ISOTime | null) => {
              if (time && time !== prefs.morningTime) setTime(time);
            }}
          />
        </SwitchRow>
      </Card>
      {denied && prefs.morningSummary ? (
        <View style={styles.denied}>
          <Text variant="caption" color="warning" style={styles.flex}>
            Los avisos están desactivados en Ajustes: no te llegará el informe.
          </Text>
          <Button label="Abrir Ajustes" size="sm" variant="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  flex: { flex: 1 },
  denied: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
