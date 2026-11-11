/**
 * Building blocks of the session library (`sessions.ts` and its recipes
 * `sessionsSwim|Bike|Run|Misc.ts`): the catalog and spec helpers, the recipe
 * contract, the interval planner, step factories, explicit targets where the
 * zone alone is not enough (sweet spot, CSS offsets, race pace, RPE-only
 * reps), the athlete's numbers for a step (zone + ppm / pace / W + RPE from
 * `zones.ts`). Coaching copy helpers live in `sessionCopy.ts`, the easier
 * version of a session in `sessionEasier.ts`. Pure.
 */
import type {
  Intensity,
  RaceDistance,
  Sport,
  StepTarget,
  Thresholds,
  WorkoutCoaching,
  WorkoutStep,
} from './types';
import {
  formatRpe,
  mainTargets,
  stepIntensity,
  stepTargets,
  targetParts,
  thresholdHr,
  zoneName,
  zoneTargets,
  type ZoneOptions,
  type ZoneTargets,
} from './zones';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type SessionCode =
  | 'SW_TECH'
  | 'SW_END'
  | 'SW_CSS'
  | 'SW_SPEED'
  | 'BK_REC'
  | 'BK_END'
  | 'BK_LONG'
  | 'BK_TEMPO'
  | 'BK_SST'
  | 'BK_THR'
  | 'BK_VO2'
  | 'BK_RP'
  | 'RN_REC'
  | 'RN_EASY'
  | 'RN_LONG'
  | 'RN_TEMPO'
  | 'RN_THR'
  | 'RN_VO2'
  | 'RN_HILLS'
  | 'BRICK'
  | 'ST_HEAVY'
  | 'ST_MAINT'
  | 'MOB'
  | 'ACTIVATION'
  | 'RACE';

export type SessionClass = 'RECOVERY' | 'EASY' | 'ENDURANCE' | 'LONG' | 'QUALITY' | 'BRICK' | 'RACE';

interface CatalogEntry {
  sport: Sport;
  cls: SessionClass;
  intensity: Intensity;
}

export const SESSION_CATALOG: Readonly<Record<SessionCode, CatalogEntry>> = {
  SW_TECH: { sport: 'swim', cls: 'EASY', intensity: 'endurance' },
  SW_END: { sport: 'swim', cls: 'ENDURANCE', intensity: 'endurance' },
  SW_CSS: { sport: 'swim', cls: 'QUALITY', intensity: 'threshold' },
  SW_SPEED: { sport: 'swim', cls: 'QUALITY', intensity: 'vo2' },
  BK_REC: { sport: 'bike', cls: 'RECOVERY', intensity: 'recovery' },
  BK_END: { sport: 'bike', cls: 'ENDURANCE', intensity: 'endurance' },
  BK_LONG: { sport: 'bike', cls: 'LONG', intensity: 'endurance' },
  BK_TEMPO: { sport: 'bike', cls: 'QUALITY', intensity: 'tempo' },
  BK_SST: { sport: 'bike', cls: 'QUALITY', intensity: 'threshold' },
  BK_THR: { sport: 'bike', cls: 'QUALITY', intensity: 'threshold' },
  BK_VO2: { sport: 'bike', cls: 'QUALITY', intensity: 'vo2' },
  BK_RP: { sport: 'bike', cls: 'QUALITY', intensity: 'race' },
  RN_REC: { sport: 'run', cls: 'RECOVERY', intensity: 'recovery' },
  RN_EASY: { sport: 'run', cls: 'EASY', intensity: 'endurance' },
  RN_LONG: { sport: 'run', cls: 'LONG', intensity: 'endurance' },
  RN_TEMPO: { sport: 'run', cls: 'QUALITY', intensity: 'tempo' },
  RN_THR: { sport: 'run', cls: 'QUALITY', intensity: 'threshold' },
  RN_VO2: { sport: 'run', cls: 'QUALITY', intensity: 'vo2' },
  RN_HILLS: { sport: 'run', cls: 'QUALITY', intensity: 'threshold' },
  BRICK: { sport: 'brick', cls: 'BRICK', intensity: 'endurance' },
  ST_HEAVY: { sport: 'strength', cls: 'QUALITY', intensity: 'tempo' },
  ST_MAINT: { sport: 'strength', cls: 'EASY', intensity: 'endurance' },
  MOB: { sport: 'mobility', cls: 'RECOVERY', intensity: 'recovery' },
  ACTIVATION: { sport: 'run', cls: 'EASY', intensity: 'endurance' },
  RACE: { sport: 'other', cls: 'RACE', intensity: 'race' },
};

export interface SessionSpec {
  code: SessionCode;
  durationMin: number;
  /** 0 = race, 1 = most protected … 7 = first to drop (§9). */
  priority: number;
  /** Brick: minutes running off the bike. */
  brickRunMin?: number;
  /** Race-pace blocks inside long sessions / bricks (build, peak). */
  racePace?: boolean;
  distanceM?: number | null;
  raceName?: string | null;
  /** Extra Spanish sentence appended to the description. */
  note?: string | null;
  intensity?: Intensity;
  sport?: Sport;
  /** Placement constraint: only these dates (race day, pre-race activation…). */
  allowedDates?: readonly string[];
  /** Brick built from the weekly long ride (race-pace blocks + easy run off the bike). */
  longBrick?: boolean;
  /** Easier version for downgrades and plan B: steady work only, no strides or pickups. */
  plain?: boolean;
  /** Distance of the race this session belongs to (race day, activation of a B race): wins over `SessionContext.raceDistance`. */
  raceDistance?: RaceDistance | null;
}

export function specSport(spec: SessionSpec): Sport {
  return spec.sport ?? SESSION_CATALOG[spec.code].sport;
}

export function specIntensity(spec: SessionSpec): Intensity {
  if (spec.intensity) return spec.intensity;
  // Long bricks are mostly Z2 with race-pace blocks (tempo); short bricks are at race pace.
  if (spec.code === 'BRICK' && spec.racePace) return spec.longBrick ? 'tempo' : 'race';
  return SESSION_CATALOG[spec.code].intensity;
}

export function specClass(spec: SessionSpec): SessionClass {
  return SESSION_CATALOG[spec.code].cls;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** What the prescriptions know about the athlete (all optional: without it only zones and RPE). */
export interface SessionContext {
  thresholds?: Thresholds | null;
  /** Distance of the target race: decides what "ritmo de carrera" means. */
  raceDistance?: RaceDistance | null;
}

export interface SessionBody {
  title: string;
  /** One short summary sentence (+ the spec note). */
  description: string;
  steps: WorkoutStep[];
}

export interface SessionContent extends SessionBody {
  coaching: WorkoutCoaching;
}

/** Zone, numbers and RPE of a step, ready for copy ("Z4", "162–168 ppm, 4:27–4:44 /km", "RPE 7–8"). */
export interface StepNumbers {
  zone: string;
  nums: string | null;
  rpe: string;
}

export interface CoachInput {
  spec: SessionSpec;
  d: number;
  body: SessionBody;
  ctx: SessionContext;
  sport: Sport;
  intensity: Intensity;
  /** Numbers of the main set (hardest work block) or of the session intensity. */
  main: StepNumbers;
  /** The easier version in one sentence (consistent with `planB.ts`), null when there is none. */
  planB: string | null;
}

export interface SessionRecipe {
  body: (spec: SessionSpec, d: number, ctx: SessionContext) => SessionBody;
  coach: (input: CoachInput) => WorkoutCoaching;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface IntervalPlan {
  reps: number;
  work: number;
  rest: number;
  warm: number;
  cool: number;
}

export interface IntervalOptions {
  warm: number;
  cool: number;
  works: readonly number[];
  rest: (work: number) => number;
  minReps: number;
  maxReps: number;
}

/** Longest work block (in `works` order) that fits at least `minReps` times, the leftover split between warm-up and cool-down. */
export function planIntervals(total: number, o: IntervalOptions): IntervalPlan {
  for (const work of o.works) {
    const rest = o.rest(work);
    const room = total - o.warm - o.cool;
    const reps = Math.min(o.maxReps, Math.floor(room / (work + rest)));
    if (reps >= o.minReps) {
      const leftover = room - reps * (work + rest);
      const extraWarm = Math.round(leftover / 2);
      return { reps, work, rest, warm: o.warm + extraWarm, cool: o.cool + leftover - extraWarm };
    }
  }
  const work = o.works[o.works.length - 1] ?? 5;
  const rest = o.rest(work);
  const reps = Math.max(1, Math.min(o.minReps, Math.floor(Math.max(0, total - 10) / (work + rest))));
  const left = Math.max(0, total - reps * (work + rest));
  const warm = Math.round(left / 2);
  return { reps, work, rest, warm, cool: left - warm };
}

export interface StepCopy {
  note?: string;
  cue?: string;
  target?: StepTarget;
  leg?: 'bike' | 'run';
}

/** A step with its optional copy (no undefined keys). */
export function step(base: WorkoutStep, copy: StepCopy = {}): WorkoutStep {
  return {
    ...base,
    ...(copy.note ? { note: copy.note } : {}),
    ...(copy.cue ? { cue: copy.cue } : {}),
    ...(copy.target ? { target: copy.target } : {}),
    ...(copy.leg ? { leg: copy.leg } : {}),
  };
}

export interface IntervalCopy {
  warm: StepCopy;
  work: StepCopy;
  rest: StepCopy;
  cool: StepCopy;
}

export function intervalSteps(p: IntervalPlan, intensity: Intensity, copy: IntervalCopy): WorkoutStep[] {
  return [
    p.warm > 0 ? step({ kind: 'warmup', durationMin: p.warm, intensity: 'recovery' }, copy.warm) : null,
    step({ kind: 'work', durationMin: p.work, intensity, repeat: p.reps }, copy.work),
    p.rest > 0 ? step({ kind: 'recovery', durationMin: p.rest, intensity: 'recovery', repeat: p.reps }, copy.rest) : null,
    p.cool > 0 ? step({ kind: 'cooldown', durationMin: p.cool, intensity: 'recovery' }, copy.cool) : null,
  ].filter((s): s is WorkoutStep => s !== null);
}

/** Warm-up, one steady block and cool-down (a single block when the session is short). */
export function steadySteps(total: number, intensity: Intensity, copy: IntervalCopy, warm = 10, cool = 5): WorkoutStep[] {
  if (total < warm + cool + 10) return [step({ kind: 'work', durationMin: total, intensity }, copy.work)];
  return [
    step({ kind: 'warmup', durationMin: warm, intensity: 'recovery' }, copy.warm),
    step({ kind: 'work', durationMin: total - warm - cool, intensity }, copy.work),
    step({ kind: 'cooldown', durationMin: cool, intensity: 'recovery' }, copy.cool),
  ];
}

// ---------------------------------------------------------------------------
// Targets and numbers
// ---------------------------------------------------------------------------

function validNumber(n: number | undefined, min: number, max: number): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

export function zoneOptions(ctx: SessionContext): ZoneOptions {
  return { raceDistance: ctx.raceDistance ?? null };
}

/** Swim CSS offsets (s/100 m) of the main sets (research 02 §2.1). */
export const CSS_OFFSETS = {
  aerobic: [6, 10],
  threshold: [-1, 2],
  speed: [-6, -4],
} as const satisfies Record<string, readonly [number, number]>;

/** Explicit swim pace from CSS + offsets, only when the CSS is known. */
export function cssTarget(ctx: SessionContext, offsets: readonly [number, number]): StepTarget | undefined {
  const css = validNumber(ctx.thresholds?.swimCssSecPer100m, 50, 300);
  if (css === null) return undefined;
  return { pace: { min: Math.round(css + offsets[0]), max: Math.round(css + offsets[1]) } };
}

/** Sweet spot: 88–94 % FTP, HR at the top of Z3 / bottom of Z4 (bike threshold HR) and RPE 6–7. */
export function sweetSpotTarget(ctx: SessionContext): StepTarget {
  const t = ctx.thresholds ?? {};
  const ftp = validNumber(t.ftpW, 50, 700);
  const hr = thresholdHr('bike', t);
  return {
    ...(ftp !== null ? { power: { min: round5(ftp * 0.88), max: round5(ftp * 0.94) } } : {}),
    ...(hr ? { hr: { min: Math.round(hr.bpm * 0.9), max: Math.round(hr.bpm * 0.95) } } : {}),
    rpe: { min: 6, max: 7 },
  };
}

/** Race-pace targets for the target race distance (only when it is known). */
export function raceTarget(sport: Sport, ctx: SessionContext, leg?: 'bike' | 'run'): StepTarget | undefined {
  if (!ctx.raceDistance || ctx.raceDistance === 'other') return undefined;
  const t = zoneTargets(sport, 'race', ctx.thresholds ?? null, { raceDistance: ctx.raceDistance, leg: leg ?? null });
  return {
    ...(t.hr ? { hr: t.hr } : {}),
    ...(t.pace ? { pace: t.pace } : {}),
    ...(t.power ? { power: t.power } : {}),
    rpe: t.rpe,
  };
}

/** RPE-only target (short reps: the heart rate lags behind). */
export function rpeTarget(min: number, max: number): StepTarget {
  return { rpe: { min, max } };
}

function numbersFrom(t: ZoneTargets, sport: Sport, intensity: Intensity, leg?: 'bike' | 'run' | null): StepNumbers {
  const parts = targetParts(t, sport, leg).filter((p) => !p.startsWith('RPE'));
  return { zone: zoneName(intensity), nums: parts.length > 0 ? parts.join(', ') : null, rpe: formatRpe(t.rpe) };
}

/** Numbers of one step of a session (explicit targets win). */
export function numbersAt(s: WorkoutStep, sport: Sport, intensity: Intensity, ctx: SessionContext): StepNumbers {
  const t = stepTargets(s, { sport, intensity }, ctx.thresholds ?? null, zoneOptions(ctx));
  return numbersFrom(t, sport, stepIntensity(s, intensity), s.leg);
}

/** Numbers of the main set, or of the session intensity without work steps. */
export function mainNumbers(sport: Sport, intensity: Intensity, steps: readonly WorkoutStep[], ctx: SessionContext): StepNumbers {
  const { set, targets } = mainTargets({ sport, intensity, steps }, ctx.thresholds ?? null, zoneOptions(ctx));
  return numbersFrom(targets, sport, set?.intensity ?? intensity, set?.step.leg);
}

/** " (162–168 ppm, 4:27–4:44 /km)" or "" without numbers. */
export function paren(nums: string | null): string {
  return nums ? ` (${nums})` : '';
}

/** First number of a list ("195–215 W, 140–150 ppm" → "195–215 W"). */
export function firstNum(nums: string | null): string | null {
  return nums ? (nums.split(', ')[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Coaching copy (sessionCopy.ts)
// ---------------------------------------------------------------------------

export {
  byCount,
  coachingOf,
  evenSets,
  intervalSummary,
  lowerStart,
  repeatableKey,
  setsText,
  startLowKey,
  theBlocks,
  theClimbs,
  theSets,
} from './sessionCopy';
