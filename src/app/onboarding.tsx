import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useProfile } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { DoneStep } from '@/features/onboarding/DoneStep';
import { IdentityStep } from '@/features/onboarding/IdentityStep';
import {
  EMPTY_RACE,
  ONBOARDING_STEPS,
  canAdvance,
  initialOnboardingState,
  type OnboardingState,
  type OnboardingStepId,
} from '@/features/onboarding/onboardingModel';
import { OnboardingHeader } from '@/features/onboarding/OnboardingHeader';
import { PermissionsStep } from '@/features/onboarding/PermissionsStep';
import { RaceStep, validateRaceInput } from '@/features/onboarding/RaceStep';
import { useOnboardingFinish } from '@/features/onboarding/useOnboardingFinish';
import { AvailabilityEditor } from '@/features/settings/AvailabilityEditor';
import { SportsLevelPicker } from '@/features/settings/SportsLevelPicker';
import { ThresholdsEditor } from '@/features/settings/ThresholdsEditor';
import { EMPTY_THRESHOLD_INPUTS } from '@/features/settings/thresholdsModel';
import { useUsernameCheck, type UsernameCheck } from '@/features/settings/useUsernameCheck';
import { Button, ErrorNotice, IconButton, Loading, Screen, space } from '@/ui';

const LAST = ONBOARDING_STEPS.length - 1;

export default function OnboardingScreen() {
  const profile = useProfile();
  const today = todayISO();
  const [state, setState] = useState<OnboardingState>(() => initialOnboardingState(profile.data));
  const [index, setIndex] = useState(0);
  const touched = useRef(false);
  const hydrated = useRef(Boolean(profile.data));
  // Set when the user presses the last button: from then on `onboardedAt` is ours, not a reason to leave.
  const [finishing, setFinishing] = useState(false);
  // Already onboarded (back gesture, stale link, second device): never re-run the wizard over a real profile.
  const alreadyOnboarded = Boolean(profile.data?.onboardedAt) && !finishing;

  useEffect(() => {
    if (alreadyOnboarded) router.replace('/today');
  }, [alreadyOnboarded]);

  // Prefill once from the server profile (created at sign-up) unless the user already typed.
  useEffect(() => {
    if (hydrated.current || !profile.data) return;
    hydrated.current = true;
    if (!touched.current) setState(initialOnboardingState(profile.data));
  }, [profile.data]);

  const check = useUsernameCheck(state.username, profile.data?.username);
  const raceError = validateRaceInput(state.race, today);
  const step = ONBOARDING_STEPS[Math.min(index, LAST)];
  const { finish, saving, error, warning } = useOnboardingFinish(profile.data?.thresholds);
  const ready = canAdvance(step.id, state, { usernameError: check.error, usernameAvailable: check.available, raceError });

  const update = (patch: Partial<OnboardingState>) => {
    touched.current = true;
    setState((prev) => ({ ...prev, ...patch }));
  };
  const goNext = () => setIndex((i) => Math.min(LAST, i + 1));
  const goBack = () => setIndex((i) => Math.max(0, i - 1));
  const skip = () => {
    if (step.id === 'thresholds') update({ thresholds: EMPTY_THRESHOLD_INPUTS });
    if (step.id === 'race') update({ race: EMPTY_RACE });
    goNext();
  };

  if (profile.isLoading || alreadyOnboarded) {
    return (
      <Screen scroll={false}>
        <Loading label="Preparando tu perfil" />
      </Screen>
    );
  }
  // A failed load must not fall through to an empty wizard: finishing it would overwrite the real profile.
  if (profile.error && !profile.data) {
    return (
      <Screen scroll={false}>
        <ErrorNotice message="No hemos podido cargar tu perfil. Revisa tu conexión." onRetry={() => void profile.refetch()} />
      </Screen>
    );
  }

  const footer = (
    <View style={styles.footer}>
      {index > 0 ? <IconButton icon="chevronLeft" variant="filled" size={48} accessibilityLabel="Atrás" onPress={goBack} /> : null}
      {step.optional ? <Button label="Saltar" variant="ghost" onPress={skip} /> : null}
      <Button
        label={step.id === 'done' ? (warning ? 'Ir a Hoy' : 'Empezar a entrenar') : 'Siguiente'}
        iconRight={step.id === 'done' ? 'bolt' : 'chevronRight'}
        size="lg"
        style={styles.next}
        loading={saving}
        disabled={!ready}
        onPress={() => {
          if (step.id !== 'done') return goNext();
          setFinishing(true);
          void finish(state);
        }}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll={false} footer={footer}>
        <ScrollView key={step.id} style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <OnboardingHeader step={step} index={index} total={ONBOARDING_STEPS.length} />
          <StepBody id={step.id} state={state} update={update} check={check} raceError={raceError} today={today} />
          {step.id === 'done' ? <DoneStep state={state} today={today} error={error} warning={warning} /> : null}
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface StepBodyProps {
  id: OnboardingStepId;
  state: OnboardingState;
  update: (patch: Partial<OnboardingState>) => void;
  check: UsernameCheck;
  raceError: string | null;
  today: string;
}

function StepBody({ id, state, update, check, raceError, today }: StepBodyProps) {
  switch (id) {
    case 'identity':
      return <IdentityStep displayName={state.displayName} username={state.username} check={check} onChange={update} />;
    case 'sports':
      return (
        <SportsLevelPicker
          sports={state.sports}
          level={state.level}
          onChangeSports={(sports) => update({ sports })}
          onChangeLevel={(level) => update({ level })}
        />
      );
    case 'availability':
      return <AvailabilityEditor value={state.availability} onChange={(availability) => update({ availability })} />;
    case 'thresholds':
      return <ThresholdsEditor value={state.thresholds} onChange={(thresholds) => update({ thresholds })} />;
    case 'race':
      return <RaceStep value={state.race} onChange={(race) => update({ race })} today={today} error={raceError} />;
    case 'permissions':
      return <PermissionsStep />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { gap: space.xl, paddingBottom: space.xxxl },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  next: { flex: 1 },
});
