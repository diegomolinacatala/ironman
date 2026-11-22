import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { autoWeeklyHours, isAutoAvailability } from '@/domain/availability';
import { todayISO } from '@/domain/dates';
import { nextRace } from '@/domain/periodization';
import type { Availability, Profile } from '@/domain/types';
import { useRaces } from '@/data/queries';
import { AvailabilityEditor } from '@/features/settings/AvailabilityEditor';
import { formatHours, normalizeAvailability, setAvailabilityMode } from '@/features/settings/availabilityModel';
import { ProfileGate } from '@/features/settings/ProfileGate';
import { SwitchRow } from '@/features/settings/SwitchRow';
import { useProfileSave } from '@/features/settings/useProfileSave';
import { Button, ErrorNotice, Screen, SectionHeader, Text, space } from '@/ui';

export default function AvailabilitySettingsScreen() {
  return <ProfileGate>{(profile) => <AvailabilityForm profile={profile} />}</ProfileGate>;
}

/** Hours of a normal load week automatic mode aims for (level × next race distance). */
function useAutoHours(profile: Profile): number {
  const races = useRaces();
  const race = nextRace(races.data ?? [], todayISO());
  return autoWeeklyHours(profile.level, race?.distance ?? null);
}

/**
 * Automatic (recommended, default): the plan fills the calendar's free time up
 * to a sensible volume for the athlete's level and race. Manual = "Ajustes
 * avanzados": the athlete's own hours, rest day, long days, pool and windows.
 */
function AvailabilityForm({ profile }: { profile: Profile }) {
  const [value, setValue] = useState<Availability>(() => normalizeAvailability(profile.availability));
  const { save, saving, error } = useProfileSave();
  const autoHours = useAutoHours(profile);
  const auto = isAutoAvailability(value);
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
      <SwitchRow
        icon="calendarBadge"
        title="Automático (recomendado)"
        subtitle="Entrenas todo lo que tu calendario permita, con cabeza."
        value={auto}
        onChange={(on) => setValue(setAvailabilityMode(value, on ? 'auto' : 'manual', autoHours))}
      />
      {auto ? (
        <Text variant="callout" color="textMuted">
          {`Restamos lo ocupado de tu calendario y la noche, y repartimos el resto: hasta unas ${formatHours(autoHours)} en las semanas de más carga, menos en base y descarga, sin subir de golpe. El descanso lo decide la carga de cada semana.`}
        </Text>
      ) : (
        <View style={styles.advanced}>
          <SectionHeader title="Ajustes avanzados" />
          <Text variant="callout" color="textMuted">
            Tu semana tipo. El planificador resta lo ocupado de tu calendario y los imprevistos, y encaja los entrenos en lo
            que queda.
          </Text>
          <AvailabilityEditor value={value} onChange={setValue} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  advanced: { gap: space.lg },
  // The footer grows with the error: keep the end of the editor scrollable above it.
  roomForError: { paddingBottom: 200 },
});
