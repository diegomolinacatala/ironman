/**
 * Structure shared by the watch exports (Garmin JSON and the provider-neutral
 * steps for COROS): the legs of a session (a brick splits into bike and run
 * following its steps' `leg`), a default structure when the plan has no steps,
 * and interval sets grouped into ONE repeat block (work and recovery sharing
 * `repeat`: 3×8' + 3' → repeat 3 of [8', 3']). Pure.
 */
import type { Intensity, Sport, Workout, WorkoutStep } from '../types.ts';

/** Sport a watch workout is created in (a brick becomes a bike and a run workout). */
export type DeviceSport = Exclude<Sport, 'brick' | 'rest'>;

export interface DeviceLeg {
  sport: DeviceSport;
  /** Brick leg (targets follow it); null outside a brick. */
  leg: 'bike' | 'run' | null;
  /** Planned minutes of this part. */
  durationMin: number;
  steps: WorkoutStep[];
  /** " · bici" / " · carrera" for brick legs, '' otherwise. */
  suffix: string;
}

export type StepBlock = { type: 'step'; step: WorkoutStep } | { type: 'repeat'; times: number; steps: WorkoutStep[] };

/** Share of a brick done on the bike when its steps do not say which leg they belong to. */
const BRICK_BIKE_SHARE = 0.75;
const LEG_SUFFIX = { bike: ' · bici', run: ' · carrera' } as const;

/** Default structure when the plan has no steps: warm-up, main block, cool-down. */
export function defaultSteps(durationMin: number, intensity: Intensity): WorkoutStep[] {
  if (durationMin < 30) return [{ kind: 'work', durationMin, intensity }];
  const warm = durationMin >= 60 ? 15 : 10;
  const cool = durationMin >= 60 ? 10 : 5;
  return [
    { kind: 'warmup', durationMin: warm, intensity: 'recovery' },
    { kind: 'work', durationMin: durationMin - warm - cool, intensity },
    { kind: 'cooldown', durationMin: cool, intensity: 'recovery' },
  ];
}

/** Times a step is done (1 without a repeat). */
export const timesOf = (step: WorkoutStep): number => (step.repeat && step.repeat > 1 ? Math.round(step.repeat) : 1);

/** Minutes of the steps, repeats included (distance steps count 0). */
export function stepsMinutes(steps: readonly WorkoutStep[]): number {
  return steps.reduce((sum, s) => sum + (s.durationMin ?? 0) * timesOf(s), 0);
}

/** Whether `step` continues the open set: same repeat, and not a new work block after the set's recovery. */
function continuesSet(block: StepBlock | undefined, step: WorkoutStep): block is Extract<StepBlock, { type: 'repeat' }> {
  if (block?.type !== 'repeat' || block.times !== timesOf(step)) return false;
  return !(step.kind === 'work' && block.steps.some((s) => s.kind !== 'work'));
}

/**
 * Consecutive steps with the same `repeat` (> 1) form one set repeated as a
 * whole: [work 8' ×3, recovery 3' ×3] → 3 × [8', 3']. Steps inside a set drop
 * their own `repeat`.
 */
export function groupSteps(steps: readonly WorkoutStep[]): StepBlock[] {
  return steps.reduce<StepBlock[]>((blocks, step) => {
    const last = blocks[blocks.length - 1];
    const { repeat: _repeat, ...single } = step;
    if (timesOf(step) === 1) return [...blocks, { type: 'step', step: single }];
    if (continuesSet(last, step)) return [...blocks.slice(0, -1), { ...last, steps: [...last.steps, single] }];
    return [...blocks, { type: 'repeat', times: timesOf(step), steps: [single] }];
  }, []);
}

function legOf(leg: 'bike' | 'run', steps: WorkoutStep[], fallbackMin: number): DeviceLeg {
  return { sport: leg, leg, durationMin: stepsMinutes(steps) || fallbackMin, steps, suffix: LEG_SUFFIX[leg] };
}

/** Brick legs from the steps' `leg` (a step without one belongs to the previous step's leg, bike first). */
function brickLegsFromSteps(w: Workout): DeviceLeg[] | null {
  if (!w.steps.some((s) => s.leg === 'bike' || s.leg === 'run')) return null;
  const tagged = w.steps.reduce<{ leg: 'bike' | 'run'; step: WorkoutStep }[]>((acc, step) => {
    const leg = step.leg ?? acc[acc.length - 1]?.leg ?? 'bike';
    return [...acc, { leg, step }];
  }, []);
  const bikeMin = Math.round(w.durationMin * BRICK_BIKE_SHARE);
  return (['bike', 'run'] as const).flatMap((leg) => {
    const steps = tagged.filter((t) => t.leg === leg).map((t) => t.step);
    return steps.length > 0 ? [legOf(leg, steps, leg === 'bike' ? bikeMin : w.durationMin - bikeMin)] : [];
  });
}

/** Brick without leg information: 75 % bike with warm-up and cool-down, then the run off the bike. */
function splitBrick(w: Workout): DeviceLeg[] {
  const bikeMin = Math.round(w.durationMin * BRICK_BIKE_SHARE);
  const runMin = w.durationMin - bikeMin;
  return [
    legOf('bike', defaultSteps(bikeMin, w.intensity), bikeMin),
    legOf('run', [{ kind: 'work', durationMin: runMin, intensity: w.intensity }], runMin),
  ];
}

/** The workouts a watch gets for one planned session: one per sport (bike + run for a brick), none for rest. */
export function deviceLegs(w: Workout): DeviceLeg[] {
  if (w.sport === 'rest' || w.durationMin <= 0) return [];
  if (w.sport === 'brick') return brickLegsFromSteps(w) ?? splitBrick(w);
  const steps = w.steps.length > 0 ? w.steps : defaultSteps(w.durationMin, w.intensity);
  return [{ sport: w.sport, leg: null, durationMin: w.durationMin, steps, suffix: '' }];
}
