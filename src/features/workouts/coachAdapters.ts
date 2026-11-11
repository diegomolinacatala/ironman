/**
 * The only place the workout UI reaches the coach's rules for "No es mi día"
 * (domain/planB) and the post-session verdict (domain/review), so screens and
 * their tests depend on one small, stable surface.
 */
import { notMyDayPatch } from '@/domain/planB';
import { reviewWorkout } from '@/domain/review';
import type { RaceDistance, Thresholds, Workout, WorkoutPatch } from '@/domain/types';

import { withoutStaleCoaching } from './form';

export interface CoachVerdictModel {
  title: string;
  detail: string;
  /** What to do next time / next session; null when the coach has nothing to add. */
  next: string | null;
}

/**
 * Patch that turns a planned session into its easier version; null when there is none (rest, done,
 * already easy). Coaching written for the harder session is cleared unless the patch brings its own.
 */
export function easierPatch(workout: Workout, thresholds: Thresholds | null): WorkoutPatch | null {
  if (workout.status !== 'planned' || workout.sport === 'rest') return null;
  const patch = notMyDayPatch(workout, thresholds);
  return patch ? withoutStaleCoaching(workout, patch) : null;
}

/** The coach's verdict on a completed session (plan vs real); null for planned or skipped ones. */
export function workoutVerdict(
  workout: Workout,
  thresholds: Thresholds | null,
  raceDistance: RaceDistance | null,
): CoachVerdictModel | null {
  if (workout.status !== 'completed') return null;
  const review = reviewWorkout(workout, thresholds, { raceDistance });
  if (!review) return null;
  return { title: review.title, detail: review.detail ?? '', next: review.next || null };
}
