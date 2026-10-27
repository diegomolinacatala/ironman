import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { errorMessage, logger } from '@/lib/logger';
import { ErrorNotice, Icon, ProgressBar, Text, haptics, space, useTheme } from '@/ui';

import { Appear } from '../Appear';
import { SuccessHero, WorkingState, useInk } from '../GuideParts';
import { StepLayout, type StepAction, type StepNav } from '../StepLayout';
import { usePlanGeneration, type PlanGeneration } from '../usePlanGeneration';

export const PLAN_PROGRESS_COPY = ['Leyendo tu Garmin…', 'Mirando tu calendario…', 'Preparando tus próximas semanas…'] as const;
const COPY_INTERVAL_MS = 1800;

export interface PlanStepProps {
  nav: StepNav;
  /** Mondays already planned (persisted by the flow). */
  plannedWeeks: readonly string[];
  onWeekPlanned: (weekStart: string) => void;
  /** Sets `onboardedAt`, forgets the saved step and goes to Hoy. */
  onFinish: () => Promise<void>;
}

/** Step 7: generates and applies the first plan, shows a 3-line summary, then Hoy. */
export function PlanStep({ nav, plannedWeeks, onWeekPlanned, onFinish }: PlanStepProps) {
  const plan = usePlanGeneration(todayISO(), { plannedWeeks, onWeekPlanned });
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await onFinish();
    } catch (err) {
      logger.warn('onboarding: finish failed', err);
      haptics.warning();
      setFinishError(errorMessage(err, 'No hemos podido terminar. Inténtalo de nuevo.'));
      setFinishing(false);
    }
  };

  return (
    <StepLayout
      nav={nav}
      busy
      title={plan.phase === 'done' ? 'Todo listo' : undefined}
      primary={primaryFor(plan, finishing, finish)}
      secondary={secondaryFor(plan, finishing, finish)}>
      <Appear index={1}>
        {plan.phase === 'working' ? <PlanProgress /> : null}
        {plan.phase === 'done' ? <PlanReady summary={plan.summary} /> : null}
        {plan.phase === 'error' ? (
          <ErrorNotice message={`${plan.error ?? 'No hemos podido preparar tu plan.'} Reinténtalo o empieza y lo preparas desde Plan.`} />
        ) : null}
      </Appear>
      {finishError ? <ErrorNotice message={finishError} /> : null}
    </StepLayout>
  );
}

function PlanProgress() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= PLAN_PROGRESS_COPY.length - 1) return undefined;
    const timer = setTimeout(() => setIndex((i) => i + 1), COPY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [index]);
  return (
    <View style={styles.block}>
      <WorkingState title={PLAN_PROGRESS_COPY[index] ?? PLAN_PROGRESS_COPY[0]} message="Suele tardar menos de un minuto." />
      <ProgressBar value={(index + 1) / (PLAN_PROGRESS_COPY.length + 1)} />
    </View>
  );
}

function PlanReady({ summary }: { summary: readonly string[] }) {
  const { colors } = useTheme();
  const { paper } = useInk();
  return (
    <SuccessHero title="Tu plan está listo" message="Lo tienes en Hoy y en Plan. Si algo cambia, cuéntaselo a tu coach.">
      <View style={styles.bullets} accessibilityRole="list">
        {summary.map((line) => (
          <View key={line} style={styles.bullet}>
            <Icon name="checkCircle" size={18} color={colors.accent} />
            <Text variant="bodyStrong" style={[styles.flex, { color: paper }]}>
              {line}
            </Text>
          </View>
        ))}
      </View>
    </SuccessHero>
  );
}

function primaryFor(plan: PlanGeneration, finishing: boolean, finish: () => Promise<void>): StepAction {
  if (plan.phase === 'working') return { label: 'Preparando…', onPress: () => undefined, loading: true };
  if (plan.phase === 'error') return { label: 'Reintentar', icon: 'refresh', onPress: plan.retry, disabled: finishing };
  return { label: 'Empezar', icon: 'bolt', onPress: () => void finish(), loading: finishing };
}

function secondaryFor(plan: PlanGeneration, finishing: boolean, finish: () => Promise<void>): StepAction | null {
  if (plan.phase !== 'error') return null;
  return { label: 'Empezar sin plan', onPress: () => void finish(), disabled: finishing };
}

const styles = StyleSheet.create({
  block: { gap: space.lg },
  flex: { flex: 1 },
  bullets: { gap: space.md },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
