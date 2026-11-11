/**
 * Planned workouts → Garmin Training API V2-like JSON (docs/research/04 §3.7),
 * so the athlete's Garmin connector in Claude can upload them to the watch.
 * Steps follow the plan (interval sets as ONE repeat block, brick legs from
 * the steps' `leg`, device-plan.ts) and targets come from the step's explicit
 * target, else the athlete's zones (mirrored domain/zones.ts, same numbers the
 * app shows): power on the bike, heart rate otherwise; pace, RPE and the cue
 * go in the step description. Pure.
 */
import type { RaceDistance, Thresholds, Workout, WorkoutStep } from '../types.ts';
import { deviceLegs, groupSteps, stepsMinutes } from './device-plan.ts';
import type { DeviceLeg, DeviceSport, StepBlock } from './device-plan.ts';
import { targetSummary } from './domain/prescription.ts';
import { formatPaceRange, formatRpe, stepIntensity, stepTargets } from './domain/zones.ts';
import type { ZoneTargets } from './domain/zones.ts';
import { formatDuration, intensityLabel, sportLabel } from './labels.ts';

export { defaultSteps } from './device-plan.ts';

export type GarminSport = 'RUNNING' | 'CYCLING' | 'LAP_SWIMMING' | 'STRENGTH_TRAINING' | 'OTHER';

const GARMIN_SPORT: Readonly<Record<DeviceSport, GarminSport>> = {
  run: 'RUNNING',
  bike: 'CYCLING',
  swim: 'LAP_SWIMMING',
  strength: 'STRENGTH_TRAINING',
  mobility: 'OTHER',
  other: 'OTHER',
};

const STEP_INTENSITY: Readonly<Record<WorkoutStep['kind'], string>> = {
  warmup: 'WARMUP',
  work: 'ACTIVE',
  recovery: 'RECOVERY',
  cooldown: 'COOLDOWN',
  rest: 'REST',
};

const STEP_DESCRIPTION_MAX = 200;

export interface DeviceOptions {
  /** Target race distance: what "ritmo de carrera" means. */
  raceDistance?: RaceDistance | null;
}

export interface StepContext {
  workout: Workout;
  leg: DeviceLeg;
  thresholds: Thresholds;
  raceDistance: RaceDistance | null;
}

/** The step's targets: its explicit `target` first, else the athlete's zones for its intensity. */
export function legStepTargets(step: WorkoutStep, ctx: StepContext): ZoneTargets {
  return stepTargets(step, ctx.workout, ctx.thresholds, { raceDistance: ctx.raceDistance, leg: ctx.leg.leg });
}

function garminTarget(sport: DeviceSport, t: ZoneTargets): Record<string, unknown> {
  if (sport === 'bike' && t.power) return { targetType: 'POWER', targetValueLow: t.power.min, targetValueHigh: t.power.max };
  if ((sport === 'bike' || sport === 'run') && t.hr) return { targetType: 'HEART_RATE', targetValueLow: t.hr.min, targetValueHigh: t.hr.max };
  return { targetType: 'OPEN' };
}

function durationOf(step: WorkoutStep): Record<string, unknown> {
  if (step.durationMin) return { durationType: 'TIME', durationValue: Math.round(step.durationMin * 60) };
  if (step.distanceM) return { durationType: 'DISTANCE', durationValue: Math.round(step.distanceM) };
  return { durationType: 'OPEN' };
}

function stepDescription(step: WorkoutStep, ctx: StepContext, t: ZoneTargets): string {
  const sport = ctx.leg.sport;
  const pace = t.pace && (sport === 'run' || sport === 'swim') ? formatPaceRange(t.pace, sport) : null;
  const zone = intensityLabel(stepIntensity(step, ctx.workout.intensity));
  return [zone, pace, formatRpe(t.rpe), step.cue, step.note].filter(Boolean).join(' · ').slice(0, STEP_DESCRIPTION_MAX);
}

function stepJson(step: WorkoutStep, order: number, ctx: StepContext): Record<string, unknown> {
  const t = legStepTargets(step, ctx);
  return {
    type: 'WorkoutStep',
    stepOrder: order,
    intensity: STEP_INTENSITY[step.kind],
    description: stepDescription(step, ctx, t),
    ...durationOf(step),
    ...garminTarget(ctx.leg.sport, t),
  };
}

function blockJson(block: StepBlock, order: number, ctx: StepContext): Record<string, unknown> {
  if (block.type === 'step') return stepJson(block.step, order, ctx);
  return {
    type: 'WorkoutRepeatStep',
    stepOrder: order,
    repeatType: 'REPEAT_UNTIL_STEPS_CMPLT',
    repeatValue: block.times,
    steps: block.steps.map((s, i) => stepJson(s, i + 1, ctx)),
  };
}

function workoutDescription(w: Workout, leg: DeviceLeg): string {
  const footer = `Road to Ironman · ${intensityLabel(w.intensity)} · ${formatDuration(leg.durationMin)}`;
  return [w.coaching?.objective, w.description, footer].filter(Boolean).join('\n').slice(0, 1000);
}

function garminWorkout(ctx: StepContext): Record<string, unknown> {
  const { workout: w, leg } = ctx;
  const sport = GARMIN_SPORT[leg.sport];
  const seconds = Math.round((stepsMinutes(leg.steps) || leg.durationMin) * 60);
  return {
    workoutName: `${w.title}${leg.suffix}`.slice(0, 60),
    description: workoutDescription(w, leg),
    sport,
    workoutProvider: 'Road to Ironman',
    workoutSourceId: w.id,
    estimatedDurationInSecs: seconds,
    segments: [{ segmentOrder: 1, sport, estimatedDurationInSecs: seconds, steps: groupSteps(leg.steps).map((b, i) => blockJson(b, i + 1, ctx)) }],
    scheduledDate: w.date,
  };
}

/** One planned workout → its Garmin workouts (two for a brick: bike + run off the bike; none for rest). */
export function toGarminWorkouts(w: Workout, thresholds: Thresholds, opts: DeviceOptions = {}): Record<string, unknown>[] {
  const raceDistance = opts.raceDistance ?? null;
  return deviceLegs(w).map((leg) => garminWorkout({ workout: w, leg, thresholds, raceDistance }));
}

/** "Carrera · Umbral 3×8' · 55 min · Umbral (Z4) · 3×8' Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8". */
export function deviceSummary(w: Workout, thresholds: Thresholds, opts: DeviceOptions = {}): string {
  const targets = targetSummary(w, thresholds, { raceDistance: opts.raceDistance ?? null });
  return [sportLabel(w.sport), w.title, formatDuration(w.durationMin), intensityLabel(w.intensity), targets].filter(Boolean).join(' · ');
}
