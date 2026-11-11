/**
 * Shortens a session's steps to a new duration the way a coach would: interval
 * sets lose repetitions (never below one) and the continuous blocks (warm-up,
 * steady work, cool-down) shrink in proportion, so the timed steps never add up
 * to more than the new duration. Distance steps (swim) scale their repetitions
 * and metres the same way. Pure.
 */
import type { WorkoutStep } from './types';

const SWIM_ROUND_M = 50;
const MIN_SET_STEP_MIN = 0.5;

function repsOf(step: WorkoutStep): number {
  return step.repeat && step.repeat > 1 ? step.repeat : 1;
}

function isBlock(step: WorkoutStep): boolean {
  return repsOf(step) === 1 && (step.durationMin ?? 0) > 0;
}

/** Fewer repetitions for sets (floor, at least one); fewer metres for single distance steps. */
function cutStep(step: WorkoutStep, factor: number): WorkoutStep {
  if (repsOf(step) > 1) {
    const repeat = Math.max(1, Math.floor(repsOf(step) * factor));
    return repeat === repsOf(step) ? step : { ...step, repeat };
  }
  if (step.durationMin || !step.distanceM) return step;
  const distanceM = Math.max(SWIM_ROUND_M, Math.round((step.distanceM * factor) / SWIM_ROUND_M) * SWIM_ROUND_M);
  return distanceM === step.distanceM ? step : { ...step, distanceM };
}

function setMinutes(steps: readonly WorkoutStep[]): number {
  return steps.reduce((sum, s) => (isBlock(s) ? sum : sum + (s.durationMin ?? 0) * repsOf(s)), 0);
}

/** When even one repetition of every set is too long, shorten each repetition (to 30" steps). */
function shrinkSets(steps: readonly WorkoutStep[], toMin: number): WorkoutStep[] {
  const total = setMinutes(steps);
  if (total <= toMin) return [...steps];
  const ratio = toMin / total;
  return steps.map((s) => {
    if (isBlock(s) || !s.durationMin) return s;
    const durationMin = Math.max(MIN_SET_STEP_MIN, Math.floor(s.durationMin * ratio * 2) / 2);
    return { ...s, durationMin };
  });
}

/** Block durations shrunk to fit `budget`: floored to whole minutes, the remainder on the longest block. */
function fitBlocks(blocks: readonly number[], budget: number): number[] {
  const total = blocks.reduce((sum, m) => sum + m, 0);
  if (total <= 0 || budget <= 0) return blocks.map(() => 0);
  const scale = Math.min(1, budget / total);
  const floored = blocks.map((m) => Math.floor(m * scale));
  const leftover = Math.min(budget, total) - floored.reduce((sum, m) => sum + m, 0);
  const longest = blocks.indexOf(Math.max(...blocks));
  return floored.map((m, i) => (i === longest ? Math.round((m + leftover) * 100) / 100 : m));
}

/**
 * Steps of a session shortened from `fromMin` to `toMin` (a copy; unchanged
 * when there is nothing to shorten). Blocks that end up at 0' are dropped.
 */
export function scaleSteps(steps: readonly WorkoutStep[], fromMin: number, toMin: number): WorkoutStep[] {
  if (steps.length === 0 || !(fromMin > 0) || !(toMin > 0) || toMin >= fromMin) return [...steps];
  const cut = shrinkSets(
    steps.map((s) => cutStep(s, toMin / fromMin)),
    toMin,
  );
  const blocks = cut.filter(isBlock).map((s) => s.durationMin ?? 0);
  const fitted = fitBlocks(blocks, toMin - setMinutes(cut));
  // Position of each block among the blocks (-1 for interval sets).
  const blockIndex = cut.map((s, i) => (isBlock(s) ? cut.slice(0, i).filter(isBlock).length : -1));
  const scaled = cut.flatMap((s, i) => {
    if (!isBlock(s)) return [s];
    const durationMin = fitted[blockIndex[i] ?? -1] ?? 0;
    if (durationMin <= 0) return [];
    return [durationMin === s.durationMin ? s : { ...s, durationMin }];
  });
  return scaled.length > 0 ? scaled : [{ kind: 'work', durationMin: toMin, intensity: steps[0]?.intensity ?? 'endurance' }];
}
