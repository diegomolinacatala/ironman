import { router } from 'expo-router';

import type { Workout } from '@/domain/types';
import { Text } from '@/ui';

import { needsHrHint } from '../targets';
import type { AthleteTargets } from '../useAthleteTargets';
import { ClosingCard, CoachingCard } from './CoachingCard';
import { FeelNote, StructureSection } from './StepList';
import { ThresholdsHint } from './ThresholdsHint';
import { WorkoutMetrics } from './WorkoutSummary';

export interface PlanSectionsProps {
  workout: Workout;
  athlete: AthleteTargets;
  /** Planned for today or later: shows "Si no es tu día". */
  upcoming: boolean;
  /** Applies the easier version; null when the session has none. */
  onEase: (() => void) | null;
  busy: boolean;
}

/**
 * The coach's prescription, in reading order: objective + keys, the main target
 * (derived from the zones when the session has no coaching), structure, success
 * criterion and plan B.
 */
export function PlanSections({ workout, athlete, upcoming, onEase, busy }: PlanSectionsProps) {
  const { thresholds, raceDistance } = athlete;
  const coaching = workout.coaching ?? null;
  const showHrHint = athlete.profileLoaded && needsHrHint(workout, thresholds);
  return (
    <>
      <CoachingCard coaching={coaching} />
      <WorkoutMetrics workout={workout} thresholds={thresholds} raceDistance={raceDistance} />
      {showHrHint ? <ThresholdsHint onPress={() => router.push('/settings/profile')} /> : null}
      <FeelNote workout={workout} thresholds={thresholds} raceDistance={raceDistance} />
      {workout.description ? <Text variant="body">{workout.description}</Text> : null}
      <StructureSection workout={workout} thresholds={thresholds} raceDistance={raceDistance} />
      <ClosingCard
        success={coaching?.success ?? null}
        showPlanB={upcoming && workout.sport !== 'rest'}
        planB={coaching?.planB ?? null}
        canEase={onEase !== null}
        onEase={() => onEase?.()}
        busy={busy}
      />
    </>
  );
}
