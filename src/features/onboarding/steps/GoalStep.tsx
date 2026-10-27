import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCreateRace, useRaces, useUpdateProfile, useUpdateRace } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { TRAINABLE_SPORTS, type Profile, type Race } from '@/domain/types';
import { DistancePicker } from '@/features/races/DistancePicker';
import { RaceDateField } from '@/features/races/RaceDateField';
import { errorMessage, logger } from '@/lib/logger';
import { Card, Chip, ErrorNotice, Loading, Segmented, Stepper, Text, TextField, haptics, space } from '@/ui';

import { formatHours } from '../../settings/availabilityModel';
import { Appear } from '../Appear';
import {
  HOURS_MAX,
  HOURS_MIN,
  HOURS_STEP,
  goalError,
  goalProfilePatch,
  goalRaceDraft,
  initialGoal,
  raceNeedsSave,
  type GoalInput,
} from '../goalModel';
import { toggleSport } from '../onboardingModel';
import { StepLayout, type StepNav } from '../StepLayout';

type RaceMode = 'race' | 'none';

export interface GoalStepProps {
  nav: StepNav;
  profile: Profile;
}

/** Step 2: next race (or "Aún no tengo carrera"), weekly hours and sports. */
export function GoalStep({ nav, profile }: GoalStepProps) {
  const races = useRaces();
  if (races.isLoading) {
    return (
      <StepLayout nav={nav} primary={{ label: 'Siguiente', onPress: () => undefined, disabled: true }}>
        <Loading label="Buscando tu carrera" />
      </StepLayout>
    );
  }
  return <GoalForm nav={nav} profile={profile} races={races.data ?? []} />;
}

function GoalForm({ nav, profile, races }: GoalStepProps & { races: Race[] }) {
  const today = todayISO();
  const updateProfile = useUpdateProfile();
  const createRace = useCreateRace();
  const updateRace = useUpdateRace();
  const [goal, setGoal] = useState<GoalInput>(() => initialGoal(profile, races, today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<GoalInput>) => setGoal((prev) => ({ ...prev, ...patch }));
  const setRace = (patch: Partial<GoalInput['race']>) => setGoal((prev) => ({ ...prev, race: { ...prev.race, ...patch } }));

  const onNext = async () => {
    const problem = goalError(goal, today);
    if (problem) {
      haptics.warning();
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProfile.mutateAsync(goalProfilePatch(goal, profile));
      const draft = goalRaceDraft(goal);
      if (draft && raceNeedsSave(goal, races)) {
        if (goal.raceId) await updateRace.mutateAsync({ id: goal.raceId, patch: draft });
        else await createRace.mutateAsync(draft);
      }
      nav.next();
    } catch (err) {
      logger.warn('onboarding: save goal failed', err);
      haptics.warning();
      setError(errorMessage(err, 'No hemos podido guardar tu objetivo. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepLayout
      nav={nav}
      busy={saving}
      primary={{ label: 'Siguiente', iconRight: 'arrowRight', onPress: () => void onNext(), loading: saving }}>
      <Appear index={1} style={styles.block}>
        <Segmented<RaceMode>
          accessibilityLabel="¿Tienes carrera?"
          options={[
            { value: 'race', label: 'Tengo carrera' },
            { value: 'none', label: 'Aún no tengo carrera' },
          ]}
          value={goal.hasRace ? 'race' : 'none'}
          onChange={(mode) => set({ hasRace: mode === 'race' })}
        />
        {goal.hasRace ? (
          <View style={styles.block}>
            <TextField
              label="Nombre de la carrera"
              value={goal.race.name}
              placeholder="Triatlón de Valencia"
              autoCapitalize="words"
              maxLength={80}
              onChangeText={(name) => setRace({ name })}
            />
            <RaceDateField value={goal.race.date} onChange={(date) => setRace({ date })} />
            <DistancePicker value={goal.race.distance} onChange={(distance) => setRace({ distance })} />
          </View>
        ) : (
          <Card variant="tinted" padding="lg">
            <Text variant="callout">Sin problema: trabajamos tu base y la añades cuando la tengas, en Tú › Tu objetivo.</Text>
          </Card>
        )}
      </Appear>
      <Appear index={2} style={styles.block}>
        <Stepper
          label="Horas a la semana"
          value={goal.weeklyHours}
          step={HOURS_STEP}
          min={HOURS_MIN}
          max={HOURS_MAX}
          format={formatHours}
          onChange={(weeklyHours) => set({ weeklyHours })}
        />
        <Text variant="caption" color="textMuted">
          Lo habitual: 5–8 h para un olímpico, 8–12 h para media distancia. Mejor quedarse corto que pasarse.
        </Text>
      </Appear>
      <Appear index={3} style={styles.block}>
        <Text variant="overline" color="textMuted">
          Qué entrenas
        </Text>
        <View style={styles.chips}>
          {TRAINABLE_SPORTS.map((sport) => (
            <Chip
              key={sport}
              label={sportLabel(sport)}
              icon={sport}
              selected={goal.sports.includes(sport)}
              onPress={() => set({ sports: toggleSport(goal.sports, sport) })}
            />
          ))}
        </View>
      </Appear>
      {error ? <ErrorNotice message={error} /> : null}
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
