import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCreateRace, useRaces, useUpdateProfile, useUpdateRace } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import { TRAINABLE_SPORTS, type Profile, type Race } from '@/domain/types';
import { DistancePicker } from '@/features/races/DistancePicker';
import { RaceDateField } from '@/features/races/RaceDateField';
import { errorMessage, logger } from '@/lib/logger';
import { Chip, ErrorNotice, Loading, Segmented, Text, TextField, haptics, space } from '@/ui';

import { Appear } from '../Appear';
import {
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
  onCreatePlan: () => void;
  onConnect: () => void;
}

/** Step 2: next race (or "Aún no tengo carrera") and sports; the weekly hours come from the calendar. */
export function GoalStep(props: GoalStepProps) {
  const races = useRaces();
  if (races.isLoading) {
    return (
      <StepLayout nav={props.nav} primary={{ label: 'Crear mi plan', onPress: () => undefined, disabled: true }}>
        <Loading label="Buscando tu carrera" />
      </StepLayout>
    );
  }
  if (races.error && !races.data) {
    return (
      <StepLayout nav={props.nav} primary={{ label: 'Reintentar', onPress: () => void races.refetch() }}>
        <ErrorNotice message={errorMessage(races.error)} />
      </StepLayout>
    );
  }
  return <GoalForm {...props} races={races.data ?? []} />;
}

function GoalForm({ nav, profile, onCreatePlan, onConnect, races }: GoalStepProps & { races: Race[] }) {
  const today = todayISO();
  const updateProfile = useUpdateProfile();
  const createRace = useCreateRace();
  const updateRace = useUpdateRace();
  const [goal, setGoal] = useState<GoalInput>(() => initialGoal(profile, races, today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<GoalInput>) => setGoal((prev) => ({ ...prev, ...patch }));
  const setRace = (patch: Partial<GoalInput['race']>) => setGoal((prev) => ({ ...prev, race: { ...prev.race, ...patch } }));

  const onNext = async (afterSave: () => void) => {
    if (saving) return;
    const problem = goalError(goal, today);
    if (problem) {
      haptics.warning();
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProfile.mutateAsync(goalProfilePatch(goal));
      const draft = goalRaceDraft(goal);
      if (draft && raceNeedsSave(goal, races)) {
        if (goal.raceId) await updateRace.mutateAsync({ id: goal.raceId, patch: draft });
        else await createRace.mutateAsync(draft);
      }
      afterSave();
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
      primary={{ label: 'Crear mi plan', iconRight: 'arrowRight', onPress: () => void onNext(onCreatePlan), loading: saving }}
      secondary={{ label: 'Configurar conexiones primero', onPress: () => void onNext(onConnect), disabled: saving }}>
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
        ) : null}
      </Appear>
      <Appear index={2} style={styles.block}>
        <Text variant="heading" accessibilityRole="header">
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
