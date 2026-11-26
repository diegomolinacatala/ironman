import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isDefaultTrainingPrefs, trainingPrefsSummary } from '@/domain/trainingPrefs';
import type { Profile, TrainingPrefs } from '@/domain/types';
import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { TrainingPrefsEditor } from '@/features/settings/TrainingPrefsEditor';
import { editablePrefs, prefSportsOf, prefsToSave } from '@/features/settings/trainingPrefsModel';
import { useProfileSave } from '@/features/settings/useProfileSave';
import { Button, ErrorNotice, Screen, Text, space } from '@/ui';

export default function TrainingPrefsScreen() {
  return <ProfileGate>{(profile) => <TrainingPrefsForm profile={profile} />}</ProfileGate>;
}

/**
 * Tú › Tu forma de entrenar: how many sessions of each sport, which days, how
 * the intensity is distributed and the fixed weekly sessions. Everything is
 * optional; what is left alone stays «Automático».
 */
function TrainingPrefsForm({ profile }: { profile: Profile }) {
  const [value, setValue] = useState<TrainingPrefs>(() => editablePrefs(profile.trainingPrefs));
  const { save, saving, error } = useProfileSave();
  const auto = isDefaultTrainingPrefs(value);
  const summary = trainingPrefsSummary(value);
  return (
    <KeyboardAvoider>
      <Screen
        inSheet
        contentStyle={error ? styles.roomForError : undefined}
        footer={
          <View style={styles.footer} testID="training-prefs-footer">
            {error ? <ErrorNotice message={error} /> : null}
            <Button
              label="Guardar"
              size="lg"
              icon="check"
              fullWidth
              loading={saving}
              onPress={() => void save({ trainingPrefs: prefsToSave(value) }, { goBack: true })}
            />
          </View>
        }>
        <Text variant="callout" color="textMuted">
          Ajusta el plan a tu manera. Lo que no toques queda en automático y el planificador decide con tu fase, tu carrera y tus
          horarios. Tu salud y la progresión de la carga siempre mandan.
        </Text>
        <View style={styles.summary}>
          <Text variant="bodyStrong">{auto ? 'Todo automático' : 'Según tu forma de entrenar'}</Text>
          {summary ? (
            <Text variant="callout" color="textMuted" testID="training-prefs-summary">
              {summary}
            </Text>
          ) : null}
          {auto ? null : (
            <Button label="Volver a automático" variant="ghost" size="sm" icon="undo" onPress={() => setValue(editablePrefs(null))} />
          )}
        </View>
        <TrainingPrefsEditor value={value} onChange={setValue} sports={prefSportsOf(profile.sports)} />
      </Screen>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  summary: { gap: space.xs, alignItems: 'flex-start' },
  roomForError: { paddingBottom: 200 },
});
