/**
 * Race-day tables shared by the race plan ("Plan de carrera", racePlan.ts) and the
 * finish-time prediction (racePrediction.ts): which distances get a plan, leg
 * distances, bike power and run pace by distance, typical leg durations. Pure.
 *
 * Coaching ranges (age-group athletes; documented so they can be reviewed):
 * - Bike power, × FTP (≈ the intensity factor of the bike leg). Allen & Coggan,
 *   "Training and Racing with a Power Meter" (IF by event length) and Friel,
 *   "The Triathlete's Training Bible": sprint 0.90–0.95, olympic 0.85–0.90,
 *   half 0.75–0.82, full 0.65–0.75. Higher than that and the run pays for it.
 * - Run pace off the bike, × threshold pace (s/km): open-race factor (5 km ≈ 0.97,
 *   10 km ≈ 1.00, half marathon ≈ 1.04, marathon ≈ 1.10 × threshold pace; Daniels,
 *   McMillan) × off-the-bike fade (+2–4 % sprint, +3–5 % olympic, +5–8 % half,
 *   +8–12 % full). Run-only races use the race row of zones.ts (no bike before).
 * - Swim effort, heart rate, RPE and sensations: the race zone of that distance in
 *   zones.ts (research 02 §2.3), so the plan and the training zones agree.
 * - Carbohydrate (racePlan.ts): Jeukendrup 2014 — ≤ 30 g/h for 1–2 h, up to 60 g/h
 *   for 2–3 h, 60–90 g/h beyond (glucose + fructose); less on the run, where the gut
 *   tolerates less; sodium 300–600 mg/h on long races.
 */
import { zoneTargets } from './zones';
import type { AthleteLevel, NumberRange, RaceDistance } from './types';

export type TriFamily = 'sprint' | 'olympic' | 'half' | 'full';
export type RunFamily = 'run_5k' | 'run_10k' | 'run_half' | 'run_marathon';
/** Distances that get a race plan ('other' does not: we do not know its legs). */
export type RaceFamily = TriFamily | RunFamily;

type Pair = readonly [number, number];

export interface LegDistances {
  /** 0 for run-only races. */
  swimM: number;
  bikeKm: number;
  runKm: number;
}

export const LEG_DISTANCES: Readonly<Record<RaceFamily, LegDistances>> = {
  sprint: { swimM: 750, bikeKm: 20, runKm: 5 },
  olympic: { swimM: 1500, bikeKm: 40, runKm: 10 },
  half: { swimM: 1900, bikeKm: 90, runKm: 21.1 },
  full: { swimM: 3800, bikeKm: 180, runKm: 42.2 },
  run_5k: { swimM: 0, bikeKm: 0, runKm: 5 },
  run_10k: { swimM: 0, bikeKm: 0, runKm: 10 },
  run_half: { swimM: 0, bikeKm: 0, runKm: 21.1 },
  run_marathon: { swimM: 0, bikeKm: 0, runKm: 42.2 },
};

/** Bike leg power, × FTP (see the header). */
export const BIKE_FTP_PCT: Readonly<Record<TriFamily, Pair>> = {
  sprint: [0.9, 0.95],
  olympic: [0.85, 0.9],
  half: [0.75, 0.82],
  full: [0.65, 0.75],
};

/** Run leg pace off the bike, × threshold pace (open-race factor × fade, see the header). */
export const RUN_OFF_BIKE_FACTOR: Readonly<Record<TriFamily, Pair>> = {
  sprint: [1.0, 1.04],
  olympic: [1.03, 1.07],
  half: [1.08, 1.13],
  full: [1.15, 1.24],
};

/** Leg minutes of an intermediate age-grouper (fueling plan before there is a prediction). */
const TYPICAL_MINUTES: Readonly<Record<RaceFamily, { swim: number; bike: number; run: number }>> = {
  sprint: { swim: 16, bike: 40, run: 28 },
  olympic: { swim: 32, bike: 75, run: 52 },
  half: { swim: 40, bike: 170, run: 120 },
  full: { swim: 80, bike: 360, run: 270 },
  run_5k: { swim: 0, bike: 0, run: 27 },
  run_10k: { swim: 0, bike: 0, run: 55 },
  run_half: { swim: 0, bike: 0, run: 120 },
  run_marathon: { swim: 0, bike: 0, run: 255 },
};

const LEVEL_TIME_FACTOR: Readonly<Record<AthleteLevel, number>> = { beginner: 1.15, intermediate: 1, advanced: 0.88 };

export function raceFamily(distance: RaceDistance | null | undefined): RaceFamily | null {
  if (!distance || distance === 'other') return null;
  return distance;
}

export function isTriathlon(family: RaceFamily): family is TriFamily {
  return family === 'sprint' || family === 'olympic' || family === 'half' || family === 'full';
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function valid(n: number | undefined, min: number, max: number): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** FTP (W) when it is usable, else null. Same bounds as zones.ts. */
export function usableFtp(ftp: number | undefined): number | null {
  return valid(ftp, 50, 700);
}

/** Running threshold pace (s/km) when usable, else null. Same bounds as zones.ts. */
export function usableThresholdPace(pace: number | undefined): number | null {
  return valid(pace, 150, 720);
}

/** CSS (s/100 m) when usable, else null. Same bounds as zones.ts. */
export function usableCss(css: number | undefined): number | null {
  return valid(css, 50, 300);
}

/** Watts for the bike leg (rounded to 5 W). */
export function bikePowerRange(family: TriFamily, ftp: number): NumberRange {
  const [lo, hi] = BIKE_FTP_PCT[family];
  return { min: round5(ftp * lo), max: round5(ftp * hi) };
}

/** Race pace (s/km, `min` = faster) for the run leg, or the whole race for run-only distances. */
export function runPaceRange(family: RaceFamily, thresholdPace: number): NumberRange {
  if (isTriathlon(family)) {
    const [lo, hi] = RUN_OFF_BIKE_FACTOR[family];
    return { min: Math.round(thresholdPace * lo), max: Math.round(thresholdPace * hi) };
  }
  const pace = zoneTargets('run', 'race', { runThresholdPaceSecPerKm: thresholdPace }, { raceDistance: family }).pace;
  return pace ?? { min: thresholdPace, max: thresholdPace };
}

/** Typical minutes per leg for the athlete's level (used to time the fueling without a prediction). */
export function typicalLegMinutes(family: RaceFamily, level: AthleteLevel | null | undefined): { swim: number; bike: number; run: number } {
  const factor = LEVEL_TIME_FACTOR[level ?? 'intermediate'] ?? 1;
  const base = TYPICAL_MINUTES[family];
  return { swim: Math.round(base.swim * factor), bike: Math.round(base.bike * factor), run: Math.round(base.run * factor) };
}
