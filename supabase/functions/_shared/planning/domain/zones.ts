// GENERATED MIRROR of src/domain/zones.ts — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/**
 * Training zones → concrete targets for a session or a step: heart rate (ppm),
 * pace (run s/km, swim s/100 m), power (W), RPE (CR-10) and how it should feel.
 *
 * Tables: docs/research/02 §2.1 (Friel HR and pace zones, Friel/Coggan power,
 * CSS offsets, RPE) and §2.3 (race intensity by distance). Heart rate uses the
 * athlete's lactate-threshold HR (`thresholds.lthr`, taken as the running one;
 * the bike one is ~3 % lower). Without it, the threshold is estimated from max
 * HR (run 0.895 × FCmáx, bike 0.87 × FCmáx) and flagged `hrEstimated`. Swim has
 * no HR target (unreliable in water): CSS pace + RPE.
 *
 * Targets are derived at render/export time from the step intensity, so plans
 * follow threshold updates; explicit `step.target` values (AI, Claude, editor,
 * special sessions) win over the derived ones.
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs (a test fails when they drift): import only
 * types here.
 */
import type { Intensity, NumberRange, RaceDistance, Sport, StepTarget, Thresholds, WorkoutStep } from './types.ts';

/** Sport family whose zones apply. */
export type ZoneSport = 'swim' | 'bike' | 'run' | 'strength' | 'mobility' | 'other';
type Pct = readonly [number, number];
type SteadyIntensity = Exclude<Intensity, 'race'>;

export interface ZoneTargets {
  /** Heart rate, ppm (null for swim or without LTHR / max HR). */
  hr: NumberRange | null;
  /** s/km (run) or s/100 m (swim); `min` is the faster end. */
  pace: NumberRange | null;
  /** Watts (bike with FTP). */
  power: NumberRange | null;
  /** Perceived exertion, CR-10. */
  rpe: NumberRange;
  /** How it should feel (talk test, breathing, technique). */
  feel: string;
  /** The HR range comes from max HR (estimated threshold), not a measured LTHR. */
  hrEstimated: boolean;
}

export interface ZoneOptions {
  /** Distance of the target race: decides what "ritmo de carrera" means (§2.3). */
  raceDistance?: RaceDistance | null;
  /** Brick leg (a brick step without leg counts as bike). */
  leg?: 'bike' | 'run' | null;
}

// ---------------------------------------------------------------------------
// Tables (research 02 §2.1 / §2.3)
// ---------------------------------------------------------------------------

/** % of the sport's lactate-threshold HR. */
const HR_PCT_LTHR: Readonly<Record<'bike' | 'run', Readonly<Record<SteadyIntensity, Pct>>>> = {
  run: { recovery: [0.75, 0.84], endurance: [0.85, 0.89], tempo: [0.9, 0.94], threshold: [0.95, 0.99], vo2: [1.0, 1.06] },
  bike: { recovery: [0.7, 0.8], endurance: [0.81, 0.89], tempo: [0.9, 0.93], threshold: [0.94, 0.99], vo2: [1.0, 1.06] },
};

/** × running threshold pace (s/km); above 1 = slower. */
const PACE_PCT: Readonly<Record<SteadyIntensity, Pct>> = {
  recovery: [1.29, 1.45],
  endurance: [1.14, 1.29],
  tempo: [1.06, 1.13],
  threshold: [0.99, 1.05],
  vo2: [0.9, 0.96],
};

/** Seconds per 100 m added to CSS. */
const CSS_OFFSET_SEC: Readonly<Record<SteadyIntensity, Pct>> = {
  recovery: [15, 20],
  endurance: [8, 15],
  tempo: [4, 8],
  threshold: [-1, 3],
  vo2: [-6, -4],
};

/** × FTP. */
const POWER_PCT: Readonly<Record<SteadyIntensity, Pct>> = {
  recovery: [0.45, 0.55],
  endurance: [0.56, 0.74],
  tempo: [0.75, 0.89],
  threshold: [0.9, 1.04],
  vo2: [1.05, 1.2],
};

const RPE: Readonly<Record<SteadyIntensity, Pct>> = {
  recovery: [1, 2],
  endurance: [3, 4],
  tempo: [5, 6],
  threshold: [7, 8],
  vo2: [9, 9],
};

const FEEL: Readonly<Record<'bike' | 'run' | 'swim', Readonly<Record<SteadyIntensity, string>>>> = {
  run: {
    recovery: 'Muy suave: respiras por la nariz y podrías charlar sin esfuerzo.',
    endurance: 'Cómodo: puedes hablar en frases completas. Si te cuesta, frena.',
    tempo: 'Controlado: frases cortas y respiración marcada, pero rítmica.',
    threshold: 'Duro y sostenido: solo palabras sueltas. Acabas cada serie pudiendo aguantar un poco más.',
    vo2: 'Muy duro: no puedes hablar. Aguantas la serie, pero poco más.',
  },
  bike: {
    recovery: 'Pedaleo suelto, sin presión en las piernas: podrías charlar todo el rato.',
    endurance: 'Cómodo y fluido: puedes hablar en frases completas. En las subidas, no te pases de zona.',
    tempo: 'Presión constante en los pedales: frases cortas, respiración marcada.',
    threshold: 'Duro y sostenido: solo palabras sueltas. Mantén la potencia estable de principio a fin.',
    vo2: 'Muy duro: no puedes hablar. Cadencia alta y aguanta hasta el final del bloque.',
  },
  swim: {
    recovery: 'Brazada larga y relajada; respiras cada 3 sin agobio.',
    endurance: 'Ritmo que podrías mantener mucho rato, con la técnica intacta.',
    tempo: 'Exigente: notas la respiración, pero la brazada sigue larga.',
    threshold: 'Duro y constante: todas las series al mismo ritmo, sin hundirte en la última.',
    vo2: 'Rápido y explosivo: descansas lo justo y no pierdes la técnica.',
  },
};

const STRENGTH_TARGET: ZoneTargets = {
  hr: null,
  pace: null,
  power: null,
  rpe: { min: 6, max: 7 },
  feel: 'Deja 2–3 repeticiones en reserva: técnica limpia y movimiento controlado.',
  hrEstimated: false,
};

const MOBILITY_TARGET: ZoneTargets = {
  hr: null,
  pace: null,
  power: null,
  rpe: { min: 1, max: 2 },
  feel: 'Sin dolor: llega a notar tensión y respira lento.',
  hrEstimated: false,
};

type RaceKey = 'sprint' | 'olympic' | 'half' | 'full' | 'run_5k' | 'run_10k' | 'run_half' | 'run_marathon';

interface RaceZone {
  power: Pct;
  bikeHr: Pct;
  runHr: Pct;
  runPace: Pct;
  css: Pct;
  rpe: Pct;
  feel: string;
}

const OLYMPIC_ZONE: RaceZone = {
  power: [0.85, 0.95],
  bikeHr: [0.9, 0.96],
  runHr: [0.95, 0.99],
  runPace: [0.99, 1.05],
  css: [-1, 1],
  rpe: [7, 8],
  feel: 'Duro y sostenido, cerca de tu umbral: solo palabras sueltas.',
};

const RACE_ZONES: Readonly<Record<RaceKey, RaceZone>> = {
  sprint: {
    power: [0.9, 1.0],
    bikeHr: [0.94, 0.99],
    runHr: [0.95, 1.02],
    runPace: [0.97, 1.05],
    css: [-3, -1],
    rpe: [8, 9],
    feel: 'Muy exigente desde el principio: respiración agitada, pero la técnica no se rompe.',
  },
  olympic: OLYMPIC_ZONE,
  half: {
    power: [0.75, 0.85],
    bikeHr: [0.85, 0.92],
    runHr: [0.92, 0.96],
    runPace: [1.03, 1.09],
    css: [2, 4],
    rpe: [6, 7],
    feel: 'Exigente pero sostenible durante horas: respiración marcada, frases cortas.',
  },
  full: {
    power: [0.65, 0.78],
    bikeHr: [0.8, 0.87],
    runHr: [0.87, 0.92],
    runPace: [1.1, 1.18],
    css: [4, 6],
    rpe: [5, 6],
    feel: 'Firme pero paciente: aún podrías hablar a ratos. Pasarte aquí se paga en la carrera a pie.',
  },
  run_5k: { ...OLYMPIC_ZONE, runHr: [1.0, 1.04], runPace: [0.92, 0.96], rpe: [9, 9], feel: 'Al límite y constante: no puedes hablar.' },
  run_10k: { ...OLYMPIC_ZONE, runHr: [0.98, 1.02], runPace: [0.96, 1.0], rpe: [8, 9], feel: 'Muy duro y regular, justo por encima de tu umbral.' },
  run_half: { ...OLYMPIC_ZONE, runHr: [0.93, 0.97], runPace: [1.02, 1.06], rpe: [7, 8], feel: 'Duro pero sostenible: palabras sueltas, zancada estable.' },
  run_marathon: {
    ...OLYMPIC_ZONE,
    runHr: [0.88, 0.92],
    runPace: [1.06, 1.12],
    rpe: [6, 7],
    feel: 'Firme y paciente: respiración controlada; los últimos kilómetros deciden.',
  },
};

/** A work block under this share of the work time is an add-on, not the main set. */
const MAIN_SET_MIN_SHARE = 0.15;
/** Efforts shorter than this (minutes) get no heart-rate target. */
const SHORT_EFFORT_MIN = 1;

/** The bike lactate threshold is usually about 3 % below the running one. */
const BIKE_LTHR_FACTOR = 0.97;
/** LTHR estimated from max HR (§2.1): run 0.89–0.90, bike 0.86–0.88. */
const MAXHR_TO_LTHR: Readonly<Record<'bike' | 'run', number>> = { run: 0.895, bike: 0.87 };

const INTENSITY_RANK: Readonly<Record<Intensity, number>> = {
  recovery: 0,
  endurance: 1,
  tempo: 2,
  race: 3,
  threshold: 4,
  vo2: 5,
};

const ZONE_NAME: Readonly<Record<Intensity, string>> = {
  recovery: 'Z1',
  endurance: 'Z2',
  tempo: 'Z3',
  threshold: 'Z4',
  vo2: 'Z5',
  race: 'Carrera',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inRange(n: number | undefined, min: number, max: number): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function range(min: number, max: number): NumberRange {
  return min <= max ? { min, max } : { min: max, max: min };
}

function scaled(base: number, pct: Pct, round: (n: number) => number): NumberRange {
  return range(round(base * pct[0]), round(base * pct[1]));
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function validRange(r: NumberRange | undefined, min: number, max: number): NumberRange | null {
  if (!r) return null;
  const lo = inRange(r.min, min, max);
  const hi = inRange(r.max, min, max);
  return lo === null || hi === null ? null : range(lo, hi);
}

function raceKeyOf(distance: RaceDistance | null | undefined): RaceKey {
  if (distance && distance !== 'other') return distance;
  return 'half';
}

/** Sport family whose zones apply (a brick counts as its leg, bike by default). */
export function zoneSportOf(sport: Sport, leg?: 'bike' | 'run' | null): ZoneSport {
  if (sport === 'brick') return leg ?? 'bike';
  if (sport === 'swim' || sport === 'bike' || sport === 'run' || sport === 'strength' || sport === 'mobility') return sport;
  return 'other';
}

/** Threshold HR used for that sport, ppm (measured LTHR, else estimated from max HR). */
export function thresholdHr(sport: 'bike' | 'run', thresholds?: Thresholds | null): { bpm: number; estimated: boolean } | null {
  const lthr = inRange(thresholds?.lthr, 100, 220);
  if (lthr !== null) return { bpm: Math.round(sport === 'bike' ? lthr * BIKE_LTHR_FACTOR : lthr), estimated: false };
  const maxHr = inRange(thresholds?.maxHr, 120, 230);
  if (maxHr !== null) return { bpm: Math.round(maxHr * MAXHR_TO_LTHR[sport]), estimated: true };
  return null;
}

function hrRange(sport: 'bike' | 'run', pct: Pct, t: Thresholds): { hr: NumberRange | null; estimated: boolean } {
  const lthr = thresholdHr(sport, t);
  if (!lthr) return { hr: null, estimated: false };
  const hr = scaled(lthr.bpm, pct, Math.round);
  const maxHr = inRange(t.maxHr, 120, 230);
  const capped = maxHr === null ? hr : range(Math.min(hr.min, maxHr), Math.min(hr.max, maxHr));
  return { hr: capped, estimated: lthr.estimated };
}

function steadyTargets(zs: 'bike' | 'run' | 'swim', intensity: SteadyIntensity, t: Thresholds): ZoneTargets {
  const rpe = range(RPE[intensity][0], RPE[intensity][1]);
  const feel = FEEL[zs][intensity];
  if (zs === 'swim') {
    const css = inRange(t.swimCssSecPer100m, 50, 300);
    const [lo, hi] = CSS_OFFSET_SEC[intensity];
    const pace = css === null ? null : range(Math.round(css + lo), Math.round(css + hi));
    return { hr: null, pace, power: null, rpe, feel, hrEstimated: false };
  }
  const { hr, estimated } = hrRange(zs, HR_PCT_LTHR[zs][intensity], t);
  if (zs === 'run') {
    const thr = inRange(t.runThresholdPaceSecPerKm, 150, 720);
    const pace = thr === null ? null : scaled(thr, PACE_PCT[intensity], Math.round);
    return { hr, pace, power: null, rpe, feel, hrEstimated: estimated };
  }
  const ftp = inRange(t.ftpW, 50, 700);
  const power = ftp === null ? null : scaled(ftp, POWER_PCT[intensity], round5);
  return { hr, pace: null, power, rpe, feel, hrEstimated: estimated };
}

function raceTargets(zs: 'bike' | 'run' | 'swim', t: Thresholds, distance: RaceDistance | null | undefined): ZoneTargets {
  const zone = RACE_ZONES[raceKeyOf(distance)];
  const rpe = range(zone.rpe[0], zone.rpe[1]);
  if (zs === 'swim') {
    const css = inRange(t.swimCssSecPer100m, 50, 300);
    const pace = css === null ? null : range(Math.round(css + zone.css[0]), Math.round(css + zone.css[1]));
    return { hr: null, pace, power: null, rpe, feel: zone.feel, hrEstimated: false };
  }
  const { hr, estimated } = hrRange(zs, zs === 'bike' ? zone.bikeHr : zone.runHr, t);
  if (zs === 'run') {
    const thr = inRange(t.runThresholdPaceSecPerKm, 150, 720);
    return { hr, pace: thr === null ? null : scaled(thr, zone.runPace, Math.round), power: null, rpe, feel: zone.feel, hrEstimated: estimated };
  }
  const ftp = inRange(t.ftpW, 50, 700);
  return { hr, pace: null, power: ftp === null ? null : scaled(ftp, zone.power, round5), rpe, feel: zone.feel, hrEstimated: estimated };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** Targets of `intensity` for `sport` with the athlete's thresholds. */
export function zoneTargets(sport: Sport, intensity: Intensity, thresholds?: Thresholds | null, opts: ZoneOptions = {}): ZoneTargets {
  const zs = zoneSportOf(sport, opts.leg);
  if (zs === 'strength') return STRENGTH_TARGET;
  if (zs === 'mobility') return MOBILITY_TARGET;
  const t = thresholds ?? {};
  if (zs === 'other') {
    const base = steadyTargets('run', intensity === 'race' ? 'threshold' : intensity, {});
    return { ...base, hr: null, pace: null };
  }
  return intensity === 'race' ? raceTargets(zs, t, opts.raceDistance) : steadyTargets(zs, intensity, t);
}

/** Intensity a step is done at (its own, else the workout's for work, easy otherwise). */
export function stepIntensity(step: WorkoutStep, workoutIntensity: Intensity): Intensity {
  if (step.intensity) return step.intensity;
  return step.kind === 'work' ? workoutIntensity : 'recovery';
}

function withOverrides(base: ZoneTargets, target: StepTarget | undefined): ZoneTargets {
  if (!target) return base;
  const hr = validRange(target.hr, 40, 230);
  return {
    ...base,
    hr: hr ?? base.hr,
    pace: validRange(target.pace, 20, 1200) ?? base.pace,
    power: validRange(target.power, 0, 2000) ?? base.power,
    rpe: validRange(target.rpe, 1, 10) ?? base.rpe,
    hrEstimated: hr ? false : base.hrEstimated,
  };
}

/** Targets of one step: explicit `step.target` values win over the derived ones. */
export function stepTargets(
  step: WorkoutStep,
  workout: { sport: Sport; intensity: Intensity },
  thresholds?: Thresholds | null,
  opts: ZoneOptions = {},
): ZoneTargets {
  const base = zoneTargets(workout.sport, stepIntensity(step, workout.intensity), thresholds, { ...opts, leg: step.leg ?? opts.leg });
  // Heart rate lags far behind efforts under a minute (strides, short hills): no ppm target there.
  const short = typeof step.durationMin === 'number' && step.durationMin > 0 && step.durationMin < SHORT_EFFORT_MIN;
  return withOverrides(short ? { ...base, hr: null, hrEstimated: false } : base, step.target);
}

// ---------------------------------------------------------------------------
// Main set and whole-session expectations
// ---------------------------------------------------------------------------

export interface MainSet {
  /** "3×8'", "10×100 m", "40'". */
  label: string;
  intensity: Intensity;
  /** The step that defines the set (first of its kind). */
  step: WorkoutStep;
}

/** Minutes for speech-free UI: 0.5 → 30", 1.5 → 1' 30", 75 → 1h 15'. */
export function formatStepMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '';
  const totalSec = Math.round(min * 60);
  if (totalSec < 60) return `${totalSec}"`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}'` : `${h}h`;
  return s > 0 ? `${m}' ${s}"` : `${m}'`;
}

function formatMeters(m: number): string {
  if (m >= 1000 && m % 100 === 0) return `${(m / 1000).toString().replace('.', ',')} km`;
  return `${Math.round(m)} m`;
}

/** "8'", "30"", "100 m", "1,5 km" (one repetition). */
export function formatStepAmount(step: WorkoutStep): string {
  if (step.durationMin) return formatStepMinutes(step.durationMin);
  if (step.distanceM) return formatMeters(step.distanceM);
  return '';
}

function stepWeight(step: WorkoutStep): number {
  const reps = step.repeat && step.repeat > 1 ? step.repeat : 1;
  return (step.durationMin ?? (step.distanceM ?? 0) / 100) * reps;
}

/** The hardest work block of a session (ties: the longest), or null without work steps. */
export function mainSet(steps: readonly WorkoutStep[], workoutIntensity: Intensity): MainSet | null {
  const all = steps.filter((s) => s.kind === 'work');
  if (all.length === 0) return null;
  // A small add-on (6×30" strides after an easy run) is not what the session is about.
  const total = all.reduce((sum, s) => sum + stepWeight(s), 0);
  const big = all.filter((s) => stepWeight(s) >= total * MAIN_SET_MIN_SHARE);
  const work = big.length > 0 ? big : all;
  const best = work.reduce((a, b) => {
    const ra = INTENSITY_RANK[stepIntensity(a, workoutIntensity)];
    const rb = INTENSITY_RANK[stepIntensity(b, workoutIntensity)];
    if (rb !== ra) return rb > ra ? b : a;
    return stepWeight(b) > stepWeight(a) ? b : a;
  });
  const amount = formatStepAmount(best);
  const label = best.repeat && best.repeat > 1 ? `${best.repeat}×${amount}` : amount;
  return { label, intensity: stepIntensity(best, workoutIntensity), step: best };
}

export interface SessionShape {
  sport: Sport;
  intensity: Intensity;
  steps: readonly WorkoutStep[];
}

/** Targets of the session's main set (or of the session intensity without steps). */
export function mainTargets(
  workout: SessionShape,
  thresholds?: Thresholds | null,
  opts: ZoneOptions = {},
): { set: MainSet | null; targets: ZoneTargets } {
  const set = mainSet(workout.steps, workout.intensity);
  const targets = set ? stepTargets(set.step, workout, thresholds, opts) : zoneTargets(workout.sport, workout.intensity, thresholds, opts);
  return { set, targets };
}

function weighted(parts: { minutes: number; range: NumberRange }[]): NumberRange | null {
  const total = parts.reduce((sum, p) => sum + p.minutes, 0);
  if (total <= 0) return null;
  const min = parts.reduce((sum, p) => sum + p.range.min * p.minutes, 0) / total;
  const max = parts.reduce((sum, p) => sum + p.range.max * p.minutes, 0) / total;
  return range(Math.round(min), Math.round(max));
}

function timedParts(workout: SessionShape, pick: (t: ZoneTargets) => NumberRange | null, thresholds: Thresholds | null | undefined, opts: ZoneOptions) {
  return workout.steps.flatMap((step) => {
    const minutes = (step.durationMin ?? 0) * (step.repeat && step.repeat > 1 ? step.repeat : 1);
    const r = pick(stepTargets(step, workout, thresholds, opts));
    return minutes > 0 && r ? [{ minutes, range: r }] : [];
  });
}

/**
 * Expected average HR of the whole session (warm-up and recoveries included,
 * weighted by time): what a watch's "FC media" should land in.
 */
export function sessionHrRange(workout: SessionShape, thresholds?: Thresholds | null, opts: ZoneOptions = {}): NumberRange | null {
  const fromSteps = weighted(timedParts(workout, (t) => t.hr, thresholds, opts));
  return fromSteps ?? zoneTargets(workout.sport, workout.intensity, thresholds, opts).hr;
}

/**
 * Expected session RPE, i.e. how the athlete will rate the whole session:
 * athletes rate an interval session by its hard part (a well-done 3×8' in Z4
 * is an RPE 7, not the time average of 4–5), so it is the main set's RPE,
 * never below the time-weighted average; without work steps, the session
 * intensity's. One definition for the app, the review and the server.
 */
export function sessionRpe(workout: SessionShape, opts: ZoneOptions = {}): NumberRange {
  const set = mainSet(workout.steps, workout.intensity);
  if (!set) return zoneTargets(workout.sport, workout.intensity, null, opts).rpe;
  const main = stepTargets(set.step, workout, null, opts).rpe;
  const average = weighted(timedParts(workout, (t) => t.rpe, null, opts));
  return average ? range(Math.max(average.min, main.min), Math.max(average.max, main.max)) : main;
}

// ---------------------------------------------------------------------------
// Formatting (Spanish UI)
// ---------------------------------------------------------------------------

/** 305 → "5:05". */
export function formatPace(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function span(r: NumberRange, fmt: (n: number) => string): string {
  return r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;
}

/** "146–153 ppm". */
export function formatHrRange(r: NumberRange): string {
  return `${span(r, String)} ppm`;
}

/** "5:06–5:46 /km" (run) · "1:50–1:57 /100 m" (swim). */
export function formatPaceRange(r: NumberRange, sport: 'run' | 'swim'): string {
  return `${span(r, formatPace)} ${sport === 'swim' ? '/100 m' : '/km'}`;
}

/** "185–225 W". */
export function formatPowerRange(r: NumberRange): string {
  return `${span(r, String)} W`;
}

/** "RPE 3–4" · "RPE 9". */
export function formatRpe(r: NumberRange): string {
  return `RPE ${span(r, String)}`;
}

/** Target pieces in the order a coach would say them for that sport (primary first). */
export function targetParts(t: ZoneTargets, sport: Sport, leg?: 'bike' | 'run' | null): string[] {
  const zs = zoneSportOf(sport, leg);
  const hr = t.hr ? formatHrRange(t.hr) : null;
  const rpe = formatRpe(t.rpe);
  if (zs === 'bike') return [t.power ? formatPowerRange(t.power) : null, hr, rpe].filter((p): p is string => p !== null);
  if (zs === 'run') return [hr, t.pace ? formatPaceRange(t.pace, 'run') : null, rpe].filter((p): p is string => p !== null);
  if (zs === 'swim') return [t.pace ? formatPaceRange(t.pace, 'swim') : null, rpe].filter((p): p is string => p !== null);
  return [rpe];
}

/** "Z2", "Z4", "Carrera". */
export function zoneName(intensity: Intensity): string {
  return ZONE_NAME[intensity];
}

// ---------------------------------------------------------------------------
// Athlete zone table (settings preview, coach and Claude context)
// ---------------------------------------------------------------------------

export interface ZoneRow {
  intensity: Intensity;
  zone: string;
  hr: NumberRange | null;
  pace: NumberRange | null;
  power: NumberRange | null;
  rpe: NumberRange;
  feel: string;
}

export interface AthleteZones {
  run: ZoneRow[];
  bike: ZoneRow[];
  swim: ZoneRow[];
  /** Threshold HR used per sport, ppm. */
  lthr: { run: number | null; bike: number | null; estimated: boolean };
  /** What is missing for full numeric targets (Spanish, e.g. "FTP"). */
  missing: string[];
}

const TABLE_INTENSITIES: readonly Intensity[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race'];

function rows(sport: 'run' | 'bike' | 'swim', t: Thresholds, opts: ZoneOptions): ZoneRow[] {
  return TABLE_INTENSITIES.map((intensity) => {
    const z = zoneTargets(sport, intensity, t, opts);
    return { intensity, zone: ZONE_NAME[intensity], hr: z.hr, pace: z.pace, power: z.power, rpe: z.rpe, feel: z.feel };
  });
}

/** Every zone with its numbers for the athlete (race row for the target race distance). */
export function athleteZones(thresholds?: Thresholds | null, opts: ZoneOptions = {}): AthleteZones {
  const t = thresholds ?? {};
  const run = thresholdHr('run', t);
  const bike = thresholdHr('bike', t);
  const missing = [
    run ? null : 'FC umbral o FC máxima',
    inRange(t.runThresholdPaceSecPerKm, 150, 720) === null ? 'ritmo umbral de carrera' : null,
    inRange(t.ftpW, 50, 700) === null ? 'FTP' : null,
    inRange(t.swimCssSecPer100m, 50, 300) === null ? 'CSS de natación' : null,
  ].filter((m): m is string => m !== null);
  return {
    run: rows('run', t, opts),
    bike: rows('bike', t, opts),
    swim: rows('swim', t, opts),
    lthr: { run: run?.bpm ?? null, bike: bike?.bpm ?? null, estimated: run?.estimated ?? false },
    missing,
  };
}
