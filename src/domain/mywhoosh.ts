/**
 * The closest free MyWhoosh workout for a planned bike session (MyWhoosh is the
 * indoor app the team rides with; shown only when the athlete turns it on in
 * Tú › Entrenamiento).
 *
 * Catalog: curated by hand from the public library listing at mywhooshinfo.com
 * (a fan site, not MyWhoosh itself), checked workout by workout on 26-11-2026:
 * folder, exact name, minutes, main set (% FTP) and its shape (reps × minutes).
 * Corrections on that check: «Threshold #1» of «Under 35 min» goes 103 → 97 %,
 * «Finding Your Flow» is 50' between 55 and 65 %, «VO2max #3» lasts 39'30" (kept
 * as 40'). The library changes: re-check a name before adding or editing it.
 *
 * Matching reads the session's own steps: the main set's kind (recovery … VO2;
 * sweet spot from its 88–94 % target or the title; race pace as tempo or sweet
 * spot by its % FTP), then the closest rep length, rep count and duration.
 * A session longer than the workout carries on as a free ride. Pure.
 */
import type { Intensity, RaceDistance, Thresholds, Workout, WorkoutStep } from './types';
import { mainSet, stepIntensity, stepTargets, zoneTargets } from './zones';

export type WhooshKind = 'recovery' | 'endurance' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2';

export interface WhooshWorkout {
  folder: string;
  /** Exact name in the MyWhoosh library. */
  name: string;
  /** Total minutes. */
  minutes: number;
  /** Main set as athletes read it ("2×20' al 95 %"). */
  mainSet: string;
  /** Shape of the main set: reps × minutes per rep (a steady ride is 1 × its main block). */
  reps: number;
  repMin: number;
}

const W = (folder: string, name: string, minutes: number, main: string, reps: number, repMin: number): WhooshWorkout => ({
  folder,
  name,
  minutes,
  mainSet: main,
  reps,
  repMin,
});

export const MYWHOOSH_CATALOG: Readonly<Record<WhooshKind, readonly WhooshWorkout[]>> = {
  recovery: [
    W('Beginner', 'Easy Does It', 28, "22' continuos al 60 %", 1, 22),
    W('Beginner', 'Open Road', 44, "2×(12' al 55 % + 6' al 60 %)", 1, 36),
    W('Endurance', 'Finding Your Flow', 58, "50' entre el 55 y el 65 %", 1, 50),
  ],
  endurance: [
    W('Endurance', 'Base Miles #1', 42, "3×(5' al 62 % + 5' al 75 %)", 1, 30),
    W('Endurance', 'Zone 2 Steady State', 60, "53' continuos al 67 %", 1, 53),
    W('Endurance', 'Zone 2 Endurance 40min', 62, "40' al 67 %", 1, 40),
    W('Endurance', '90 Minute Endurance', 90, 'Z2 con cambios del 65 al 75 %', 1, 84),
    W('Taper', '100min Spin 90 and 80', 100, '3 bloques de 8×(1\'30" al 72 % + 1\' al 52 %)', 3, 20),
  ],
  tempo: [
    W('Tempo', 'Tempo #5', 54, "20' al 81 % + 2×5' al 96 %", 1, 20),
    W('Tempo', 'Tempo #10', 70, "3×10' al 80 %", 3, 10),
  ],
  sweetspot: [
    W('Under 35 min', 'Sweetspot #1', 31, "3×6' al 86 %", 3, 6),
    W('Sweetspot', 'Sweetspot #1', 50, "3×8' al 86 %", 3, 8),
    W('Sweetspot', 'Sweet Spot 15', 62, "2×15' al 88 %", 2, 15),
    W('Sweetspot', 'Sweetspot 20 minute', 59, "20' del 88 al 94 % + 5×1' al 98 %", 1, 20),
  ],
  threshold: [
    W('Under 35 min', 'Threshold #1', 28, "3×5' del 103 al 97 %", 3, 5),
    W('Threshold', 'Threshold #1', 58, "5×5' del 103 al 91 %", 5, 5),
    W('Threshold', 'Threshold 15', 58, "2×15' al 95 %", 2, 15),
    W('Threshold', 'Threshold 20', 61, "2×20' al 95 %", 2, 20),
  ],
  vo2: [
    // The library spells this one with a zero: «V02max».
    W('Under 35 min', 'V02max x 3min', 32, "2×3' al 105 %", 2, 3),
    W('VO2max', 'VO2max #3', 40, "3×3' al 105 %", 3, 3),
    W('VO2max', 'VO2max 4min #1', 54, "3×4' al 106 %", 3, 4),
    W('VO2max', 'VO2max 3min #1', 70, "6×3' al 107–108 %", 6, 3),
  ],
};

/** What a bike session asks for, read from its steps (or its title when it has none). */
export interface BikeShape {
  kind: WhooshKind;
  /** Reps of the main set; null when the session does not say. */
  reps: number | null;
  /** Minutes per rep of the main set; null when the session does not say. */
  repMin: number | null;
}

export type WhooshSession = Pick<Workout, 'sport' | 'intensity' | 'title' | 'durationMin'> &
  Partial<Pick<Workout, 'steps' | 'description'>>;

export interface WhooshContext {
  /** The athlete's thresholds (FTP turns explicit watts into % FTP). */
  thresholds?: Thresholds | null;
  /** Target race distance: what "ritmo de carrera" means. */
  raceDistance?: RaceDistance | null;
}

export interface MyWhooshPick {
  workout: WhooshWorkout;
  /** The session's minutes when it lasts longer than the workout (ride on freely until then), else null. */
  freeRideUntil: number | null;
  /** Zone of that free ride: 'uno' after a recovery ride, 'dos' otherwise. */
  freeRideZone: 'uno' | 'dos';
}

const SWEET_SPOT_RE = /sweet\s*spot/i;
/** "3×8'", "2x20 min", "4×4’": reps and minutes per rep written in a title. */
const SETS_RE = /(\d{1,2})\s*[x×]\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:'|’|min\b)/i;
/** Sweet spot is 88–94 % FTP: a threshold step whose power target sits in this band is sweet spot. */
const SWEET_SPOT_PCT: readonly [number, number] = [0.85, 0.95];
/** Race pace from this % FTP (or RPE) up is sweet spot; below it, tempo. */
const RACE_SWEET_SPOT_PCT = 0.87;
const RACE_SWEET_SPOT_RPE = 7;
/** Rides longer than this are «90 Minute Endurance» plus a free ride (the library has no longer Z2 workout). */
export const LONG_RIDE_MIN = 105;
/** Extra minutes from which the line tells you to keep riding. */
export const FREE_RIDE_MIN = 10;
/** Weights of the match: rep length first, then the session's length, then the rep count. */
const WEIGHT = { repMin: 3, minutes: 1.5, reps: 1 } as const;
const INTERVAL_KINDS: ReadonlySet<WhooshKind> = new Set(['tempo', 'sweetspot', 'threshold', 'vo2']);

function validFtp(thresholds: Thresholds | null | undefined): number | null {
  const ftp = thresholds?.ftpW;
  return typeof ftp === 'number' && Number.isFinite(ftp) && ftp >= 50 && ftp <= 700 ? ftp : null;
}

function midPct(range: { min: number; max: number } | null | undefined, ftp: number | null): number | null {
  if (!range || ftp === null) return null;
  return (range.min + range.max) / 2 / ftp;
}

function mentionsSweetSpot(w: WhooshSession, step: WorkoutStep | null): boolean {
  return [w.title, w.description ?? '', step?.note ?? '', step?.cue ?? ''].some((text) => SWEET_SPOT_RE.test(text));
}

/** A threshold step done at sweet spot: an explicit 88–94 % power target or the RPE 6–7 the library gives it. */
function isSweetSpotStep(step: WorkoutStep, ftp: number | null): boolean {
  const pct = midPct(step.target?.power, ftp);
  if (pct !== null) return pct >= SWEET_SPOT_PCT[0] && pct < SWEET_SPOT_PCT[1];
  const rpe = step.target?.rpe;
  return rpe !== undefined && rpe.max <= RACE_SWEET_SPOT_RPE;
}

/** Race pace is tempo or sweet spot depending on how hard it is for the target race (% FTP, else RPE). */
function racePaceKind(w: WhooshSession, step: WorkoutStep | null, ctx: WhooshContext): WhooshKind {
  const opts = { raceDistance: ctx.raceDistance ?? null };
  const targets = step ? stepTargets(step, w, ctx.thresholds ?? null, opts) : zoneTargets('bike', 'race', ctx.thresholds ?? null, opts);
  const pct = midPct(targets.power, validFtp(ctx.thresholds));
  if (pct !== null) return pct >= RACE_SWEET_SPOT_PCT ? 'sweetspot' : 'tempo';
  return (targets.rpe.min + targets.rpe.max) / 2 >= RACE_SWEET_SPOT_RPE ? 'sweetspot' : 'tempo';
}

function kindOf(w: WhooshSession, intensity: Intensity, step: WorkoutStep | null, ctx: WhooshContext): WhooshKind {
  if (intensity !== 'recovery' && intensity !== 'vo2' && mentionsSweetSpot(w, step)) return 'sweetspot';
  switch (intensity) {
    case 'recovery':
      return 'recovery';
    case 'tempo':
      return 'tempo';
    case 'threshold':
      return step && isSweetSpotStep(step, validFtp(ctx.thresholds)) ? 'sweetspot' : 'threshold';
    case 'vo2':
      return 'vo2';
    case 'race':
      return racePaceKind(w, step, ctx);
    default:
      return 'endurance';
  }
}

/** Reps of the main set: its own repeat, plus identical blocks written as separate steps. */
function repsOf(steps: readonly WorkoutStep[], main: WorkoutStep, intensity: Intensity, workoutIntensity: Intensity): number {
  const length = main.durationMin ?? 0;
  return steps
    .filter((s) => s.kind === 'work' && stepIntensity(s, workoutIntensity) === intensity && Math.abs((s.durationMin ?? 0) - length) <= 1)
    .reduce((sum, s) => sum + (s.repeat && s.repeat > 1 ? s.repeat : 1), 0);
}

function setsFromTitle(title: string): { reps: number; repMin: number } | null {
  const match = SETS_RE.exec(title);
  if (!match) return null;
  const reps = Number(match[1]);
  const repMin = Number((match[2] ?? '').replace(',', '.'));
  return reps > 0 && repMin > 0 ? { reps, repMin } : null;
}

/** Kind and main-set shape of a bike session. */
export function bikeShape(w: WhooshSession, ctx: WhooshContext = {}): BikeShape {
  const steps = w.steps ?? [];
  const set = mainSet(steps, w.intensity);
  if (set && set.step.durationMin) {
    return {
      kind: kindOf(w, set.intensity, set.step, ctx),
      reps: Math.max(1, repsOf(steps, set.step, set.intensity, w.intensity)),
      repMin: set.step.durationMin,
    };
  }
  const fromTitle = setsFromTitle(w.title);
  return { kind: kindOf(w, w.intensity, set?.step ?? null, ctx), reps: fromTitle?.reps ?? null, repMin: fromTitle?.repMin ?? null };
}

function relDiff(a: number, b: number): number {
  return a === b ? 0 : Math.abs(a - b) / Math.max(a, b);
}

function scoreOf(c: WhooshWorkout, shape: BikeShape, minutes: number): number {
  const interval = INTERVAL_KINDS.has(shape.kind);
  const rep = interval && shape.repMin ? relDiff(shape.repMin, c.repMin) * WEIGHT.repMin : 0;
  const reps = interval && shape.reps ? relDiff(shape.reps, c.reps) * WEIGHT.reps : 0;
  return rep + reps + relDiff(minutes, c.minutes) * WEIGHT.minutes;
}

function closestIn(options: readonly WhooshWorkout[], shape: BikeShape, minutes: number): WhooshWorkout {
  const first = options[0] as WhooshWorkout;
  return options.reduce((best, o) => (scoreOf(o, shape, minutes) < scoreOf(best, shape, minutes) ? o : best), first);
}

const NINETY_MINUTES = MYWHOOSH_CATALOG.endurance.find((o) => o.name === '90 Minute Endurance') as WhooshWorkout;

/** The closest MyWhoosh workout for a bike session; null for other sports or sessions without minutes. */
export function myWhooshFor(w: WhooshSession, ctx: WhooshContext = {}): MyWhooshPick | null {
  if (w.sport !== 'bike' || !(w.durationMin > 0)) return null;
  const minutes = Math.round(w.durationMin);
  const shape = bikeShape(w, ctx);
  const workout =
    shape.kind === 'endurance' && minutes > LONG_RIDE_MIN ? NINETY_MINUTES : closestIn(MYWHOOSH_CATALOG[shape.kind], shape, minutes);
  return {
    workout,
    freeRideUntil: minutes - workout.minutes >= FREE_RIDE_MIN ? minutes : null,
    freeRideZone: shape.kind === 'recovery' ? 'uno' : 'dos',
  };
}

/** "MyWhoosh › Threshold › Threshold 20 (2×20' al 95 %, 61')" (+ the free ride when the session is longer). */
export function myWhooshText(pick: MyWhooshPick): string {
  const o = pick.workout;
  const base = `MyWhoosh › ${o.folder} › ${o.name} (${o.mainSet}, ${o.minutes}')`;
  return pick.freeRideUntil === null
    ? base
    : `${base} y sigue en rodada libre en zona ${pick.freeRideZone} hasta completar ${pick.freeRideUntil} minutos`;
}

/** The same for VoiceOver: no "›" and minutes in words. */
export function myWhooshA11y(pick: MyWhooshPick): string {
  const o = pick.workout;
  const base = `En rodillo: MyWhoosh, carpeta ${o.folder}, ${o.name}: ${o.mainSet}, ${o.minutes} minutos`;
  return pick.freeRideUntil === null
    ? `${base}.`
    : `${base}, y sigue en rodada libre en zona ${pick.freeRideZone} hasta completar ${pick.freeRideUntil} minutos.`;
}
