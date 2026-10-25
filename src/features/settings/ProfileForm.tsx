import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AthleteLevel, Profile, TrainableSport } from '@/domain/types';
import { Button, ErrorNotice, SectionHeader, Text, TextField, space } from '@/ui';

import { SportsLevelPicker } from './SportsLevelPicker';
import { ThresholdsEditor } from './ThresholdsEditor';
import { parseThresholdInputs, thresholdsToInputs, type ThresholdInputs } from './thresholdsModel';
import { UsernameField } from './UsernameField';
import { useProfileSave } from './useProfileSave';
import { useUsernameCheck } from './useUsernameCheck';

const COACH_NOTES_MAX = 4000;

/** Editable profile: identity, sports & level, thresholds and coach notes. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [sports, setSports] = useState<TrainableSport[]>(profile.sports);
  const [level, setLevel] = useState<AthleteLevel>(profile.level);
  const [thresholds, setThresholds] = useState<ThresholdInputs>(() => thresholdsToInputs(profile.thresholds));
  const [coachNotes, setCoachNotes] = useState(profile.coachNotes ?? '');
  const check = useUsernameCheck(username, profile.username);
  const parsed = useMemo(() => parseThresholdInputs(thresholds, profile.thresholds), [thresholds, profile.thresholds]);
  const { save, saving, error } = useProfileSave();

  const nameError = displayName.trim().length === 0 ? 'Escribe tu nombre' : null;
  const canSave = !nameError && !check.error && check.available !== false && sports.length > 0 && parsed.isValid;

  const onSave = () =>
    save(
      {
        displayName: displayName.trim(),
        username,
        sports,
        level,
        thresholds: parsed.thresholds,
        coachNotes: coachNotes.trim() ? coachNotes.trim() : null,
      },
      { goBack: true },
    );

  return (
    <View style={styles.wrap}>
      <SectionHeader title="Quién eres" />
      <TextField
        label="Nombre"
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        maxLength={60}
        error={nameError}
      />
      <UsernameField value={username} onChange={setUsername} check={check} />

      <SectionHeader title="Deportes y nivel" />
      <SportsLevelPicker sports={sports} level={level} onChangeSports={setSports} onChangeLevel={setLevel} />

      <SectionHeader title="Umbrales" />
      <ThresholdsEditor value={thresholds} onChange={setThresholds} />

      <SectionHeader title="Lo que tu coach debe saber" />
      <TextField
        value={coachNotes}
        onChangeText={setCoachNotes}
        multiline
        maxLength={COACH_NOTES_MAX}
        placeholder="Lo que tu coach debe saber: dieta, lesiones previas, preferencias…"
        hint={`El coach de la app y tu Claude lo leen siempre. ${coachNotes.length}/${COACH_NOTES_MAX}`}
      />

      {error ? <ErrorNotice message={error} /> : null}
      <Button label="Guardar" size="lg" icon="check" fullWidth loading={saving} disabled={!canSave} onPress={() => void onSave()} />
      {!canSave ? (
        <Text variant="caption" color="textMuted" align="center">
          Revisa los campos marcados para poder guardar.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
});
