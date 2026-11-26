/**
 * Weekly run volume and its cap (docs/research/02 §6.3). Running causes most
 * triathlon overuse injuries, so a week's run minutes never grow more than
 * 15 % over the biggest run week of the last 3, with a small minimum extra (low
 * volumes can still grow) and a floor of two short runs (an athlete who stopped
 * running can start again). Bricks count their run leg. Without any completed
 * workout in those weeks there is no history and no cap.
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs (a test fails when they drift): the app's
 * rules planner and the server's planning context (AI coach, Claude) use the
 * same number. Import only constants, dates and types here.
 */
import { BRICK_BIKE_SHARE, RUN_PEAK_WEEKS, RUN_WEEKLY_FLOOR_MIN, RUN_WEEKLY_MIN_EXTRA, RUN_WEEKLY_MINUTES_GROWTH } from './constants';
import { addDays } from './dates';
import type { ISODate, Sport, WorkoutStatus, WorkoutStep } from './types';

/** What the run volume reads from a workout (the app's and the server's `Workout` both fit). */
export interface RunVolumeWorkout {
  date: ISODate;
  sport: Sport;
  status: WorkoutStatus;
  durationMin: number;
  steps?: readonly WorkoutStep[] | null;
  completed?: { durationMin?: number | null } | null;
}

function stepsMinutes(steps: readonly WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

/** Share of a brick spent running: from its run-leg steps when they are tagged, else the default bike/run split. */
function brickRunShare(steps: readonly WorkoutStep[] | null | undefined): number {
  const list = steps ?? [];
  const all = stepsMinutes(list);
  const run = stepsMinutes(list.filter((s) => s.leg === 'run'));
  return all > 0 && run > 0 ? run / all : 1 - BRICK_BIKE_SHARE;
}

/** Run minutes of a workout (the completed minutes once done): a whole run, a brick's run leg, 0 for other sports. */
export function workoutRunMinutes(w: RunVolumeWorkout): number {
  if (w.sport !== 'run' && w.sport !== 'brick') return 0;
  const done = w.status === 'completed' ? w.completed?.durationMin : null;
  const minutes = Math.max(0, typeof done === 'number' && Number.isFinite(done) ? done : w.durationMin);
  return w.sport === 'run' ? minutes : minutes * brickRunShare(w.steps);
}

/**
 * Completed run minutes of each of the `weeks` weeks before `weekStart` (oldest
 * first), or null when nothing at all was completed in them (no history: no cap).
 */
export function recentRunMinutes(workouts: readonly RunVolumeWorkout[], weekStart: ISODate, weeks: number = RUN_PEAK_WEEKS): number[] | null {
  const from = addDays(weekStart, -7 * weeks);
  const done = workouts.filter((w) => w.status === 'completed' && w.date >= from && w.date < weekStart);
  if (done.length === 0) return null;
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 7);
    return Math.round(done.filter((w) => w.date >= start && w.date < end).reduce((sum, w) => sum + workoutRunMinutes(w), 0));
  });
}

/**
 * Most run minutes for the week: +15 % over the biggest recent run week, at
 * least +10' and never below two short runs (50'); null without history.
 */
export function runWeekCapMinutes(recent: readonly number[] | null | undefined): number | null {
  const weeks = (recent ?? []).filter((m) => Number.isFinite(m) && m >= 0);
  if (weeks.length === 0) return null;
  const peak = Math.max(...weeks);
  return Math.round(Math.max(peak * RUN_WEEKLY_MINUTES_GROWTH, peak + RUN_WEEKLY_MIN_EXTRA, RUN_WEEKLY_FLOOR_MIN));
}
