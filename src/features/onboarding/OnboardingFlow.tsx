import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useIntegrations, useTokens, useUpdateProfile } from '@/data/queries';
import type { CreatedToken, Profile } from '@/domain/types';
import { Loading, Screen, haptics } from '@/ui';

import {
  emptyProgress,
  nextStepId,
  onboardingFacts,
  prevStepId,
  resolveResumeStep,
  stepIndexOf,
  visibleSteps,
  type OnboardingStepId,
  type StoredProgress,
} from './onboardingModel';
import type { StepNav } from './StepLayout';
import { CalendarStep } from './steps/CalendarStep';
import { ClaudeStep } from './steps/ClaudeStep';
import { GarminStep } from './steps/GarminStep';
import { GoalStep } from './steps/GoalStep';
import { MorningStep } from './steps/MorningStep';
import { PlanStep } from './steps/PlanStep';
import { WelcomeStep } from './steps/WelcomeStep';
import { useOnboardingProgress } from './useOnboardingProgress';

export interface OnboardingFlowProps {
  profile: Profile;
  userId: string;
  isDemo: boolean;
  /** Called right before `onboardedAt` is saved, so the screen does not bounce to Hoy on its own. */
  onFinishing: () => void;
}

type ProgressPatch = Partial<Omit<StoredProgress, 'version'>>;

/** Step machine host: resumes the saved step, persists every move and renders the current step. */
export function OnboardingFlow({ profile, userId, isDemo, onFinishing }: OnboardingFlowProps) {
  const steps = useMemo(() => visibleSteps(Platform.OS), []);
  const progress = useOnboardingProgress(userId);
  const integrations = useIntegrations();
  const tokens = useTokens();
  const updateProfile = useUpdateProfile();
  const [state, setState] = useState<StoredProgress | null>(null);
  const stateRef = useRef<StoredProgress | null>(null);
  // The connector URL is shown once: keep the token for the whole session (only its id is persisted).
  const [claudeToken, setClaudeToken] = useState<CreatedToken | null>(null);
  const factsReady = progress.loaded && !integrations.isLoading && !tokens.isLoading;

  useEffect(() => {
    if (stateRef.current || !factsReady) return;
    const local = progress.saved ?? emptyProgress('welcome');
    const facts = onboardingFacts(profile, integrations.data, tokens.data, local);
    const initial: StoredProgress = { ...local, claudeDone: facts.claudeDone, step: resolveResumeStep(steps, progress.saved?.step ?? null, facts) };
    stateRef.current = initial;
    setState(initial);
  }, [factsReady, progress.saved, profile, integrations.data, tokens.data, steps]);

  /** Merges, renders and persists (per user) in one go. */
  const persist = useCallback(
    (patch: ProgressPatch) => {
      const base = stateRef.current;
      if (!base) return;
      const next: StoredProgress = { ...base, ...patch };
      stateRef.current = next;
      setState(next);
      progress.save(next);
    },
    [progress],
  );

  const finish = useCallback(async () => {
    onFinishing();
    await updateProfile.mutateAsync({ onboardedAt: new Date().toISOString() });
    await progress.clear();
    haptics.success();
    router.replace('/today');
  }, [onFinishing, updateProfile, progress]);

  if (!state) {
    return (
      <Screen scroll={false}>
        <Loading label="Preparando tu bienvenida" />
      </Screen>
    );
  }

  const step = steps[stepIndexOf(steps, state.step)] ?? steps[0];
  if (!step) return null;
  const nextId = nextStepId(steps, step.id);
  const prev = step.id === 'plan' ? null : prevStepId(steps, step.id);
  const goTo = (id: OnboardingStepId | null, patch: ProgressPatch = {}) => {
    if (id) persist({ ...patch, step: id });
  };
  const nav: StepNav = {
    step,
    index: stepIndexOf(steps, step.id),
    total: steps.length,
    next: () => goTo(nextId),
    back: prev ? () => goTo(prev) : undefined,
  };

  switch (step.id) {
    case 'welcome':
      return <WelcomeStep nav={nav} profile={profile} />;
    case 'goal':
      return <GoalStep nav={nav} profile={profile} />;
    case 'garmin':
      return <GarminStep nav={nav} isDemo={isDemo} skipped={state.garminSkipped} onSkip={() => goTo(nextId, { garminSkipped: true })} />;
    case 'claude':
      return (
        <ClaudeStep
          nav={nav}
          profile={profile}
          isDemo={isDemo}
          token={claudeToken}
          onToken={(token) => {
            setClaudeToken(token);
            persist({ claudeTokenId: token.token.id });
          }}
          storedTokenId={state.claudeTokenId}
          done={state.claudeDone}
          onDone={() => goTo(nextId, { claudeDone: true })}
        />
      );
    case 'calendar':
      return <CalendarStep nav={nav} />;
    case 'morning':
      return <MorningStep nav={nav} profile={profile} />;
    case 'plan':
      return (
        <PlanStep
          nav={nav}
          plannedWeeks={state.plannedWeeks}
          onWeekPlanned={(week) => persist({ plannedWeeks: [...(stateRef.current?.plannedWeeks ?? []), week] })}
          onFinish={finish}
        />
      );
    default:
      return null;
  }
}
