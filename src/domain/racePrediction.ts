/**
 * Finish-time prediction for the A race, per leg and total, as a range
 * (optimistic – conservative) built on the race plan's targets. Pure.
 *
 * Assumptions (also summed up for the athlete in `note`):
 * - Swim: open water at the plan's effort (CSS + the race offset of zones.ts) plus
 *   3–6 s/100 m for sighting and no walls, and a course up to 3 % longer than
 *   nominal (navigation). No wetsuit gain counted. Without CSS, a CSS typical of
 *   the level (beginner 2:25, intermediate 2:00, advanced 1:40 /100 m), 5 s wider
 *   and flagged `swimEstimated`.
 * - Bike: speed from the plan's power band with the flat-course model of
 *   bikeSpeed.ts. Optimistic = top of the band on a flat course; conservative =
 *   bottom of the band + 4 % for turns, aid stations, rolling roads and wind.
 *   Without FTP: the median speed of the athlete's recent rides at a race-like
 *   heart rate (≥ 3 rides of ≥ 45' and ≥ 15 km, average HR within the race band
 *   −10/+5 ppm), conservative 6 % slower (group riding, easier courses).
 * - Run: the plan's pace band; conservative adds a tough day's fade (sprint 1 %,
 *   olympic 2 %, half 4 %, full 7 %; 5 km 1 %, 10 km 2 %, half marathon 3 %,
 *   marathon 6 %; +2 % for beginners).
 * - Transitions: typical age-group times per distance.
 * - Total: sum of the legs' ends (transparent: the legs add up to the total).
 */
import { bikeModelFor, flatSpeedKmh } from './bikeSpeed';
import {
  LEG_DISTANCES,
  bikePowerRange,
  isTriathlon,
  raceFamily,
  runPaceRange,
  usableCss,
  usableFtp,
  usableThresholdPace,
  type RaceFamily,
  type TriFamily,
} from './raceDay';
import type { AthleteLevel, ISODate, NumberRange, RaceDistance, Thresholds } from './types';
import { zoneTargets } from './zones';

/** A completed ride as the prediction needs it. */
export interface RidePoint {
  date: ISODate;
  durationMin: number;
  distanceM: number;
  avgHr: number | null;
}

export interface PredictionInput {
  distance: RaceDistance;
  thresholds?: Thresholds | null;
  level?: AthleteLevel | null;
  /** Completed rides of the last weeks (used only without FTP). */
  recentRides?: readonly RidePoint[] | null;
}

export interface RacePrediction {
  family: RaceFamily;
  /** Minutes per leg, `min` = optimistic. Null legs do not exist in that race. */
  swim: NumberRange | null;
  t1: NumberRange | null;
  bike: NumberRange | null;
  t2: NumberRange | null;
  run: NumberRange;
  total: NumberRange;
  bikeSource: 'power' | 'rides' | null;
  swimEstimated: boolean;
  /** One line: what the prediction assumes. */
  note: string;
}

export type PredictionOutcome = { ok: true; prediction: RacePrediction } | { ok: false; missing: string[]; hint: string };

type Pair = readonly [number, number];

const TRANSITIONS: Readonly<Record<TriFamily, { t1: Pair; t2: Pair }>> = {
  sprint: { t1: [1.5, 3], t2: [1, 2] },
  olympic: { t1: [2, 4], t2: [1.5, 2.5] },
  half: { t1: [3, 6], t2: [2, 4] },
  full: { t1: [5, 10], t2: [3, 7] },
};

const RUN_FADE: Readonly<Record<RaceFamily, number>> = {
  sprint: 0.01,
  olympic: 0.02,
  half: 0.04,
  full: 0.07,
  run_5k: 0.01,
  run_10k: 0.02,
  run_half: 0.03,
  run_marathon: 0.06,
};
const BEGINNER_EXTRA_FADE = 0.02;

const LEVEL_CSS: Readonly<Record<AthleteLevel, number>> = { beginner: 145, intermediate: 120, advanced: 100 };
const OPEN_WATER_SEC: Pair = [3, 6];
const SWIM_COURSE_EXTRA = 0.03;
const ESTIMATED_SWIM_EXTRA_SEC = 5;
const BIKE_COURSE_EXTRA = 0.04;

const RIDES_MIN = 3;
const RIDE_MIN_MINUTES = 45;
const RIDE_MIN_METERS = 15_000;
const RIDE_SPEED_KMH: Pair = [15, 50];
const RIDE_HR_BELOW = 10;
const RIDE_HR_ABOVE = 5;
const RIDES_CONSERVATIVE = 0.94;

function range(min: number, max: number): NumberRange {
  return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
}

function swimLeg(family: TriFamily, t: Thresholds, level: AthleteLevel): { minutes: NumberRange; estimated: boolean } {
  const css = usableCss(t.swimCssSecPer100m);
  const estimated = css === null;
  const effort = zoneTargets('swim', 'race', { swimCssSecPer100m: css ?? LEVEL_CSS[level] }, { raceDistance: family }).pace;
  const pace = effort ?? { min: LEVEL_CSS[level], max: LEVEL_CSS[level] };
  const hundreds = LEG_DISTANCES[family].swimM / 100;
  const slow = pace.max + OPEN_WATER_SEC[1] + (estimated ? ESTIMATED_SWIM_EXTRA_SEC : 0);
  return {
    minutes: range((hundreds * (pace.min + OPEN_WATER_SEC[0])) / 60, (hundreds * slow * (1 + SWIM_COURSE_EXTRA)) / 60),
    estimated,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Median km/h of recent rides at a race-like heart rate, or null when there are too few. */
export function rideSpeedAtRaceHr(rides: readonly RidePoint[], raceHr: NumberRange): number | null {
  const speeds = rides.flatMap((r) => {
    if (r.durationMin < RIDE_MIN_MINUTES || r.distanceM < RIDE_MIN_METERS || r.avgHr === null) return [];
    if (r.avgHr < raceHr.min - RIDE_HR_BELOW || r.avgHr > raceHr.max + RIDE_HR_ABOVE) return [];
    const kmh = r.distanceM / 1000 / (r.durationMin / 60);
    return kmh >= RIDE_SPEED_KMH[0] && kmh <= RIDE_SPEED_KMH[1] ? [kmh] : [];
  });
  return speeds.length >= RIDES_MIN ? median(speeds) : null;
}

function bikeLeg(family: TriFamily, t: Thresholds, level: AthleteLevel, rides: readonly RidePoint[]): { minutes: NumberRange; source: 'power' | 'rides' } | null {
  const km = LEG_DISTANCES[family].bikeKm;
  const ftp = usableFtp(t.ftpW);
  if (ftp !== null) {
    const power = bikePowerRange(family, ftp);
    const model = bikeModelFor(level);
    const fast = flatSpeedKmh(power.max, model);
    const slow = flatSpeedKmh(power.min, model);
    return { minutes: range((km / fast) * 60, (km / slow) * 60 * (1 + BIKE_COURSE_EXTRA)), source: 'power' };
  }
  const hr = zoneTargets('bike', 'race', t, { raceDistance: family }).hr;
  const speed = hr ? rideSpeedAtRaceHr(rides, hr) : null;
  if (speed === null) return null;
  return { minutes: range((km / speed) * 60, (km / (speed * RIDES_CONSERVATIVE)) * 60), source: 'rides' };
}

function runLeg(family: RaceFamily, thresholdPace: number, level: AthleteLevel): NumberRange {
  const pace = runPaceRange(family, thresholdPace);
  const km = LEG_DISTANCES[family].runKm;
  const fade = RUN_FADE[family] + (level === 'beginner' ? BEGINNER_EXTRA_FADE : 0);
  return range((km * pace.min) / 60, (km * pace.max * (1 + fade)) / 60);
}

function noteFor(triathlon: boolean, swimEstimated: boolean, bikeSource: 'power' | 'rides' | null): string {
  const base = triathlon ? 'Supone recorrido llano, sin viento, y que sigues el plan.' : 'Supone recorrido llano y que sigues el plan.';
  const extras = [swimEstimated ? 'Natación estimada sin CSS.' : null, bikeSource === 'rides' ? 'Bici según tus salidas recientes.' : null];
  return [base, ...extras.filter((e): e is string => e !== null)].join(' ');
}

function sum(parts: readonly (NumberRange | null)[]): NumberRange {
  return range(
    parts.reduce((acc, p) => acc + (p?.min ?? 0), 0),
    parts.reduce((acc, p) => acc + (p?.max ?? 0), 0),
  );
}

function missingHint(missing: readonly string[]): string {
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`;
  return `Para ver tu previsión, añade ${list} en Tú › Perfil.`;
}

function triPrediction(family: TriFamily, t: Thresholds, level: AthleteLevel, thresholdPace: number, rides: readonly RidePoint[]): PredictionOutcome {
  const bike = bikeLeg(family, t, level, rides);
  if (!bike) return { ok: false, missing: ['tu FTP'], hint: missingHint(['tu FTP']) };
  const swim = swimLeg(family, t, level);
  const run = runLeg(family, thresholdPace, level);
  const tr = TRANSITIONS[family];
  const t1 = range(tr.t1[0], tr.t1[1]);
  const t2 = range(tr.t2[0], tr.t2[1]);
  return {
    ok: true,
    prediction: {
      family,
      swim: swim.minutes,
      t1,
      bike: bike.minutes,
      t2,
      run,
      total: sum([swim.minutes, t1, bike.minutes, t2, run]),
      bikeSource: bike.source,
      swimEstimated: swim.estimated,
      note: noteFor(true, swim.estimated, bike.source),
    },
  };
}

/**
 * Predicted times, or why they cannot be predicted (missing FTP / threshold pace);
 * null for a distance without known legs ('other').
 */
export function predictRace(input: PredictionInput): PredictionOutcome | null {
  const family = raceFamily(input.distance);
  if (!family) return null;
  const t = input.thresholds ?? {};
  const level = input.level ?? 'intermediate';
  const thresholdPace = usableThresholdPace(t.runThresholdPaceSecPerKm);
  const triathlon = isTriathlon(family);
  if (thresholdPace === null) {
    const missing = triathlon && usableFtp(t.ftpW) === null ? ['tu FTP', 'tu ritmo umbral'] : ['tu ritmo umbral'];
    return { ok: false, missing, hint: missingHint(missing) };
  }
  if (triathlon) return triPrediction(family, t, level, thresholdPace, input.recentRides ?? []);
  const run = runLeg(family, thresholdPace, level);
  return {
    ok: true,
    prediction: { family, swim: null, t1: null, bike: null, t2: null, run, total: run, bikeSource: null, swimEstimated: false, note: noteFor(false, false, null) },
  };
}

/** Middle of each leg's range, minutes: times the race plan's fueling. */
export function centralLegMinutes(p: RacePrediction): { swim?: number; bike?: number; run: number } {
  const mid = (r: NumberRange) => Math.round((r.min + r.max) / 2);
  return { ...(p.swim ? { swim: mid(p.swim) } : {}), ...(p.bike ? { bike: mid(p.bike) } : {}), run: mid(p.run) };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 301 → "5:01" (h:mm). */
function hoursMinutes(minutes: number): string {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 24.5 → "24:30" (m:ss). */
function minutesSeconds(minutes: number): string {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Whole-race range: "5:01–5:29" (h:mm), or "23:40–24:55" (m:ss) under an hour. */
export function formatFinishRange(r: NumberRange): string {
  const fmt = r.max < 60 ? minutesSeconds : hoursMinutes;
  return `${fmt(r.min)}–${fmt(r.max)}`;
}

/** Leg range: "35–38'", "2:38–2:50", "58'–1:04". */
export function formatLegRange(r: NumberRange): string {
  const lo = Math.round(r.min);
  const hi = Math.round(r.max);
  if (hi < 60) return lo === hi ? `${lo}'` : `${lo}–${hi}'`;
  if (lo >= 60) return `${hoursMinutes(r.min)}–${hoursMinutes(r.max)}`;
  return `${lo}'–${hoursMinutes(r.max)}`;
}
