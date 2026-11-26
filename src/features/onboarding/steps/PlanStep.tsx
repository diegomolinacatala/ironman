import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { SeasonPreview } from '@/features/season/SeasonPreview';
import { useSeasonPreview } from '@/features/season/useSeasonPreview';
import { errorMessage, logger } from '@/lib/logger';
import { Disclosure, ErrorNotice, Icon, Text, haptics, iconSize, space, useTheme } from '@/ui';

import { Appear } from '../Appear';
import { SuccessHero, WorkingState } from '../GuideParts';
import { StepLayout, type StepAction, type StepNav } from '../StepLayout';
import { usePlanGeneration, type PlanGeneration } from '../usePlanGeneration';

export interface PlanStepProps {
  nav: StepNav;
  /** Mondays already planned (persisted by the flow). */
  plannedWeeks: readonly string[];
  onWeekPlanned: (weekStart: string) => void;
  /** Sets `onboardedAt`, forgets the saved step and goes to Hoy. */
  onFinish: () => Promise<void>;
}

/**
 * Step 7: generates and applies the first plan, shows a 3-line summary and how
 * the next weeks lead to the race ("Así llegarás a tu carrera"), then Hoy.
 */
export function PlanStep({ nav, plannedWeeks, onWeekPlanned, onFinish }: PlanStepProps) {
  const plan = usePlanGeneration(todayISO(), { plannedWeeks, onWeekPlanned });
  const season = useSeasonPreview();
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
        {plan.phase === 'working' ? <WorkingState title="Organizando tus sesiones…" /> : null}
        {plan.phase === 'done' ? <PlanReady summary={plan.summary} /> : null}
        {plan.phase === 'error' ? (
          <ErrorNotice message={`${plan.error ?? 'No hemos podido preparar tu plan.'} Reinténtalo o empieza y lo preparas desde Plan.`} />
        ) : null}
      </Appear>
      {plan.phase === 'done' && season ? (
        <Appear index={2}>
          <Disclosure variant="plain" icon="week" title="Ver las próximas semanas">
            <SeasonPreview season={season} />
          </Disclosure>
        </Appear>
      ) : null}
      {finishError ? <ErrorNotice message={finishError} /> : null}
    </StepLayout>
  );
}

function PlanReady({ summary }: { summary: readonly string[] }) {
  const { colors } = useTheme();
  return (
    <SuccessHero title="Tu plan está listo" message="Abre Hoy para ver tu próxima sesión.">
      <View style={styles.bullets} accessibilityRole="list">
        {summary.map((line) => (
          <View key={line} style={styles.bullet}>
            <Icon name="checkCircle" size={iconSize.md} color={colors.success} />
            <Text variant="bodyStrong" style={styles.flex}>
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
  return { label: 'Ir a Hoy', iconRight: 'arrowRight', onPress: () => void finish(), loading: finishing };
}

function secondaryFor(plan: PlanGeneration, finishing: boolean, finish: () => Promise<void>): StepAction | null {
  if (plan.phase !== 'error') return null;
  return { label: 'Empezar sin plan', onPress: () => void finish(), disabled: finishing };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bullets: { gap: space.md },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
