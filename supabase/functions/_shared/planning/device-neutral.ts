/**
 * Provider-neutral watch workouts, made for COROS (created by Claude through
 * the official COROS connector, or copied by hand in the COROS app): the same
 * parts and repeat blocks as the Garmin export with plain numbers any watch
 * app takes — heart rate in ppm and in % of the athlete's threshold HR (else of
 * max HR), pace in whole seconds per km (or per 100 m), power in W, RPE and
 * the cue — plus the sport and whether the COROS connector can create it (run
 * and bike yes; swim, strength and the rest by hand). Pure.
 */
import type { NumberRange, RaceDistance, Thresholds, Workout, WorkoutStep, WorkoutStepKind } from '../types.ts';
import { legStepTargets } from './device.ts';
import type { DeviceOptions, StepContext } from './device.ts';
import { deviceLegs, groupSteps, stepsMinutes } from './device-plan.ts';
import type { DeviceLeg, DeviceSport, StepBlock } from './device-plan.ts';
import { formatPaceRange, stepIntensity, zoneName } from './domain/zones.ts';
import type { ZoneTargets } from './domain/zones.ts';
import { sportLabel } from './labels.ts';

type Pair = [number, number];

export interface NeutralStep {
  type: WorkoutStepKind;
  /** One repetition. */
  durationSec?: number;
  distanceM?: number;
  /** "Z1"…"Z5" or "Carrera" (run, bike and swim). */
  zone?: string;
  hrBpm?: Pair;
  /** % of the threshold HR the athlete set (FC umbral); without it, % of max HR. */
  hrPctLthr?: Pair;
  hrPctMax?: Pair;
  paceSecPerKm?: Pair;
  paceSecPer100m?: Pair;
  /** "5:08–5:48 /km", "1:48–1:55 /100 m". */
  pace?: string;
  powerW?: Pair;
  rpe: Pair;
  cue?: string;
}

export type NeutralBlock = NeutralStep | { type: 'repeat'; times: number; steps: NeutralStep[] };

export interface NeutralWorkout {
  name: string;
  /** Sport to create it in: run, bike, swim, strength, mobility or other. */
  sport: DeviceSport;
  scheduledDate: string;
  estimatedDurationSec: number;
  /** 'connector': Claude can create it with the COROS connector; 'manual': create it by hand in COROS. */
  coros: 'connector' | 'manual';
  corosNote?: string;
  steps: NeutralBlock[];
}

/** Sports the COROS connector can create (run, bike; trail runs are run workouts). */
const COROS_CONNECTOR_SPORTS: readonly DeviceSport[] = ['run', 'bike'];
const VALID_LTHR = { min: 100, max: 220 } as const;
const VALID_MAX_HR = { min: 120, max: 230 } as const;

const pair = (r: NumberRange): Pair => [Math.round(r.min), Math.round(r.max)];

function pctOf(r: NumberRange, base: number): Pair {
  return [Math.round((r.min / base) * 100), Math.round((r.max / base) * 100)];
}

const within = (v: number | null | undefined, b: { min: number; max: number }): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max ? v : null;

function hrFields(hr: NumberRange | null, thresholds: Thresholds): Partial<NeutralStep> {
  if (!hr) return {};
  const lthr = within(thresholds.lthr, VALID_LTHR);
  if (lthr !== null) return { hrBpm: pair(hr), hrPctLthr: pctOf(hr, lthr) };
  const maxHr = within(thresholds.maxHr, VALID_MAX_HR);
  return maxHr !== null ? { hrBpm: pair(hr), hrPctMax: pctOf(hr, maxHr) } : { hrBpm: pair(hr) };
}

function paceFields(pace: NumberRange | null, sport: DeviceSport): Partial<NeutralStep> {
  if (!pace || (sport !== 'run' && sport !== 'swim')) return {};
  const whole = { min: Math.round(pace.min), max: Math.round(pace.max) };
  const text = formatPaceRange(whole, sport);
  return sport === 'run' ? { paceSecPerKm: pair(whole), pace: text } : { paceSecPer100m: pair(whole), pace: text };
}

function amountOf(step: WorkoutStep): Partial<NeutralStep> {
  if (step.durationMin) return { durationSec: Math.round(step.durationMin * 60) };
  if (step.distanceM) return { distanceM: Math.round(step.distanceM) };
  return {};
}

function neutralStep(step: WorkoutStep, ctx: StepContext): NeutralStep {
  const t: ZoneTargets = legStepTargets(step, ctx);
  const sport = ctx.leg.sport;
  const usesZones = sport === 'run' || sport === 'bike' || sport === 'swim';
  return {
    type: step.kind,
    ...amountOf(step),
    ...(usesZones ? { zone: zoneName(stepIntensity(step, ctx.workout.intensity)) } : {}),
    ...(sport === 'swim' ? {} : hrFields(t.hr, ctx.thresholds)),
    ...paceFields(t.pace, sport),
    ...(sport === 'bike' && t.power ? { powerW: pair(t.power) } : {}),
    rpe: pair(t.rpe),
    ...(step.cue?.trim() || step.note?.trim() ? { cue: [step.cue?.trim(), step.note?.trim()].filter(Boolean).join(' ') } : {}),
  };
}

function neutralBlock(block: StepBlock, ctx: StepContext): NeutralBlock {
  if (block.type === 'step') return neutralStep(block.step, ctx);
  return { type: 'repeat', times: block.times, steps: block.steps.map((s) => neutralStep(s, ctx)) };
}

function corosOf(leg: DeviceLeg): Pick<NeutralWorkout, 'coros' | 'corosNote'> {
  if (COROS_CONNECTOR_SPORTS.includes(leg.sport)) return { coros: 'connector' };
  return { coros: 'manual', corosNote: `${sportLabel(leg.sport)}: créalo a mano en COROS (app › Perfil › Biblioteca de entrenamientos › «+»).` };
}

function neutralWorkout(ctx: StepContext): NeutralWorkout {
  const { workout: w, leg } = ctx;
  return {
    name: `${w.title}${leg.suffix}`.slice(0, 60),
    sport: leg.sport,
    scheduledDate: w.date,
    estimatedDurationSec: Math.round((stepsMinutes(leg.steps) || leg.durationMin) * 60),
    ...corosOf(leg),
    steps: groupSteps(leg.steps).map((b) => neutralBlock(b, ctx)),
  };
}

/** One planned workout → provider-neutral watch workouts (two for a brick; none for rest). */
export function toNeutralWorkouts(w: Workout, thresholds: Thresholds, opts: DeviceOptions = {}): NeutralWorkout[] {
  const raceDistance: RaceDistance | null = opts.raceDistance ?? null;
  return deviceLegs(w).map((leg) => neutralWorkout({ workout: w, leg, thresholds, raceDistance }));
}
