import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Availability, Profile } from '@/domain/types';
import { AvailabilityEditor } from '@/features/settings/AvailabilityEditor';
import { normalizeAvailability } from '@/features/settings/availabilityModel';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { useProfileSave } from '@/features/settings/useProfileSave';
import { Button, ErrorNotice, Screen, Text, space } from '@/ui';

export default function AvailabilitySettingsScreen() {
  return <ProfileGate>{(profile) => <AvailabilityForm profile={profile} />}</ProfileGate>;
}

function AvailabilityForm({ profile }: { profile: Profile }) {
  const [value, setValue] = useState<Availability>(() => normalizeAvailability(profile.availability));
  const { save, saving, error } = useProfileSave();
  return (
    <Screen
      inSheet
      contentStyle={error ? styles.roomForError : undefined}
      footer={
        // The error sits next to the pinned button: the end of the editor may be off-screen.
        <View style={styles.footer} testID="availability-footer">
          {error ? <ErrorNotice message={error} /> : null}
          <Button
            label="Guardar disponibilidad"
            size="lg"
            icon="check"
            fullWidth
            loading={saving}
            onPress={() => void save({ availability: value }, { goBack: true })}
          />
        </View>
      }>
      <Text variant="callout" color="textMuted">
        Tu semana tipo. El planificador resta lo ocupado de tu calendario y los imprevistos, y encaja los entrenos en lo
        que queda.
      </Text>
      <AvailabilityEditor value={value} onChange={setValue} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  // The footer grows with the error: keep the end of the editor scrollable above it.
  roomForError: { paddingBottom: 200 },
});
