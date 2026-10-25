/**
 * Training constants for the deterministic rules engine.
 *
 * Every value is tagged with its evidence level, following
 * docs/research/02-reglas-entrenamiento.md §0:
 * - [C] consensus / strong evidence → "hard" constant, change only after review.
 * - [E] limited evidence (single study, vendor data) → configurable default.
 * - [H] coaching heuristic / product decision → tunable parameter.
 * Section references (§) point to that document.
 */
import type { Intensity, RaceDistance, Sport } from './types';

export const RULES_VERSION = '2026.10-r1';

// ---------------------------------------------------------------------------
// Load model (§3, §4)
// ---------------------------------------------------------------------------

/** PMC time constants in days. [C] §4.1 */
export const CTL_TAU = 42;
export const ATL_TAU = 7;
/** Freshness floor / warning for projected TSB. [C] floor (TrainingPeaks), [H] warning §4.3 */
export const TSB_FLOOR = -30;
export const TSB_WARN = -20;

/** Session RPE (1-10) → relative intensity. [H] §3.1 (Foster sRPE rescaled) */
export const RPE_TO_IF: Readonly<Record<number, number>> = {
  1: 0.5,
  2: 0.55,
  3: 0.62,
  4: 0.7,
  5: 0.76,
  6: 0.82,
  7: 0.88,
  8: 0.94,
  9: 1.0,
  10: 1.08,
};

/**
 * Whole-session IF by intensity, bike reference (includes warm-up/cool-down).
 * Calibrated so that h × IF² × 100 ≈ the default TSS/h of §3.2. [H]
 */
export const BIKE_SESSION_IF: Readonly<Record<Intensity, number>> = {
  recovery: 0.55, // 30 TSS/h
  endurance: 0.71, // 50
  tempo: 0.81, // 65
  threshold: 0.92, // 85
  vo2: 0.905, // 82 (intervals, long recoveries)
  race: 0.82, // ~68 (middle-distance race pace)
};

/** Run whole-session IF (rTSS/h of §3.2). [H] */
export const RUN_SESSION_IF: Readonly<Record<Intensity, number>> = {
  recovery: 0.67, // 45
  endurance: 0.74, // 55
  tempo: 0.84, // 70
  threshold: 0.92, // 85
  vo2: 0.905, // 82
  race: 0.85, // 72
};

/** Swim whole-session IF, used with the cubic sTSS formula (h × IF³ × 100). [C] formula, [H] values §3.1-3.2 */
export const SWIM_SESSION_IF: Readonly<Record<Intensity, number>> = {
  recovery: 0.67, // 30
  endurance: 0.79, // 49
  tempo: 0.866, // 65
  threshold: 0.909, // 75
  vo2: 0.88, // 68
  race: 0.86, // 64
};

/** Fixed load per hour for sports without an IF model. [H] §3.1-3.2 */
export const FIXED_TSS_PER_HOUR: Readonly<Partial<Record<Sport, number>>> = {
  strength: 35,
  mobility: 15,
  rest: 0,
};

/** Share of a brick that is bike (rest is the run off the bike). [H] */
export const BRICK_BIKE_SHARE = 0.75;

// ---------------------------------------------------------------------------
// Compliance (§11.1 point 6, research 01 §4.4.3)
// ---------------------------------------------------------------------------

/** TrainingPeaks compliance bands, in % of plan. [C] de-facto standard */
export const COMPLIANCE_BANDS = { doneMin: 80, doneMax: 120, partialMin: 50, partialMax: 150 } as const;

// ---------------------------------------------------------------------------
// Ramp rate (§4.2)
// ---------------------------------------------------------------------------

/** CTL ramp per week (low-risk / moderate upper bounds by current CTL). [C] TrainingPeaks / Friel */
export const RAMP_TABLE: readonly { maxCtl: number; low: number; moderate: number }[] = [
  { maxCtl: 45, low: 3, moderate: 6 },
  { maxCtl: 70, low: 4, moderate: 7 },
  { maxCtl: Number.POSITIVE_INFINITY, low: 5, moderate: 8 },
];
export const RAMP_HARD_CAP = 8; // [C/H]
export const RAMP_LIFE_STRESS_PENALTY = 2; // [C qualitative / H number]

/** Generic load per hour used to translate minutes ↔ load when only minutes are known. [H] */
export const GENERIC_TSS_PER_HOUR = 55;

// ---------------------------------------------------------------------------
// Periodization (§5)
// ---------------------------------------------------------------------------

export interface PhaseDurations {
  /** Full taper weeks before race week (Friel "peak"). */
  peak: number;
  build: { min: number; ideal: number };
  base: { min: number; ideal: number; max: number };
  prep: { min: number; ideal: number };
  /** Minimum viable plan length in weeks. */
  minViable: number;
  /** Easy days after the race (transition). */
  transitionDays: number;
}

/** Phase lengths counted backwards from the A race. [H] §5.2 */
export const PHASE_TABLE: Readonly<Record<RaceDistance, PhaseDurations>> = {
  sprint: { peak: 0, build: { min: 4, ideal: 6 }, base: { min: 4, ideal: 8, max: 12 }, prep: { min: 0, ideal: 2 }, minViable: 8, transitionDays: 4 },
  olympic: { peak: 1, build: { min: 6, ideal: 8 }, base: { min: 6, ideal: 10, max: 14 }, prep: { min: 0, ideal: 2 }, minViable: 10, transitionDays: 7 },
  half: { peak: 1, build: { min: 6, ideal: 10 }, base: { min: 6, ideal: 12, max: 16 }, prep: { min: 2, ideal: 3 }, minViable: 12, transitionDays: 14 },
  full: { peak: 2, build: { min: 8, ideal: 12 }, base: { min: 8, ideal: 14, max: 20 }, prep: { min: 2, ideal: 4 }, minViable: 18, transitionDays: 21 },
  run_5k: { peak: 0, build: { min: 4, ideal: 5 }, base: { min: 4, ideal: 8, max: 12 }, prep: { min: 0, ideal: 2 }, minViable: 6, transitionDays: 3 },
  run_10k: { peak: 0, build: { min: 4, ideal: 6 }, base: { min: 4, ideal: 8, max: 12 }, prep: { min: 0, ideal: 2 }, minViable: 6, transitionDays: 4 },
  run_half: { peak: 1, build: { min: 6, ideal: 8 }, base: { min: 4, ideal: 8, max: 12 }, prep: { min: 0, ideal: 2 }, minViable: 8, transitionDays: 7 },
  run_marathon: { peak: 2, build: { min: 8, ideal: 10 }, base: { min: 6, ideal: 10, max: 14 }, prep: { min: 2, ideal: 2 }, minViable: 12, transitionDays: 18 },
  other: { peak: 0, build: { min: 4, ideal: 6 }, base: { min: 4, ideal: 8, max: 12 }, prep: { min: 0, ideal: 2 }, minViable: 8, transitionDays: 5 },
};

export interface TaperFactors {
  /** Week −2 (null = normal build week). */
  minus2: number | null;
  /** Week −1. */
  minus1: number;
  /** Race week, excluding the race itself. */
  raceWeek: number;
}

/** Weekly volume relative to the average build week. [H] inside the [C] 41-60 % range §5.4 */
export const TAPER_FACTORS: Readonly<Record<RaceDistance, TaperFactors>> = {
  sprint: { minus2: null, minus1: 0.85, raceWeek: 0.55 },
  olympic: { minus2: null, minus1: 0.78, raceWeek: 0.5 },
  half: { minus2: 0.88, minus1: 0.68, raceWeek: 0.45 },
  full: { minus2: 0.78, minus1: 0.62, raceWeek: 0.4 },
  run_5k: { minus2: null, minus1: 0.85, raceWeek: 0.6 },
  run_10k: { minus2: null, minus1: 0.8, raceWeek: 0.55 },
  run_half: { minus2: null, minus1: 0.75, raceWeek: 0.5 },
  run_marathon: { minus2: 0.8, minus1: 0.65, raceWeek: 0.45 },
  other: { minus2: null, minus1: 0.85, raceWeek: 0.6 },
};

/** Distance family used by volume curves, splits and session priorities. */
export type DistanceKind = 'tri_short' | 'tri_long' | 'run';

export type Subphase =
  | 'prep'
  | 'base1'
  | 'base2'
  | 'base3'
  | 'build1'
  | 'build2'
  | 'maintenance';

/** Fraction of peak weekly hours per subphase. [H, inspired by Friel] §6.2 */
export const VOLUME_CURVE: Readonly<Record<DistanceKind | 'full', Readonly<Record<Subphase, number>>>> = {
  tri_short: { prep: 0.55, base1: 0.68, base2: 0.78, base3: 0.88, build1: 0.9, build2: 0.88, maintenance: 0.75 },
  tri_long: { prep: 0.55, base1: 0.65, base2: 0.75, base3: 0.85, build1: 0.95, build2: 1.0, maintenance: 0.75 },
  full: { prep: 0.55, base1: 0.62, base2: 0.72, base3: 0.82, build1: 0.92, build2: 1.0, maintenance: 0.75 },
  run: { prep: 0.55, base1: 0.68, base2: 0.78, base3: 0.88, build1: 0.92, build2: 0.9, maintenance: 0.75 },
};

/** Load-week progression inside a block (3:1 and 2:1). [H] §5.5 */
export const BLOCK_PROGRESSION_31 = [0.95, 1.0, 1.05] as const;
export const BLOCK_PROGRESSION_21 = [0.97, 1.03] as const;
/** Recovery week volume factor. [H] §5.5 */
export const RECOVERY_FACTOR_31 = 0.6;
export const RECOVERY_FACTOR_21 = 0.65;
/** Transition (post A race) and post-B recovery volume. [H] */
export const TRANSITION_FACTOR = 0.35;
export const POST_B_RECOVERY_FACTOR = 0.6;
/** Mini taper of a B race week (volume −35 %). [H] §5.3 */
export const B_RACE_WEEK_FACTOR = 0.65;
export const C_RACE_WEEK_FACTOR = 0.9;

// ---------------------------------------------------------------------------
// Volume, sport split and sessions (§6-§9)
// ---------------------------------------------------------------------------

/** % of weekly time per sport (swim, bike, run, strength). [H] §7 */
export interface SportSplit {
  swim: number;
  bike: number;
  run: number;
  strength: number;
}

export const SPLIT_PREP: SportSplit = { swim: 0.25, bike: 0.35, run: 0.25, strength: 0.15 };
export const SPLIT_BASE_LONG: SportSplit = { swim: 0.2, bike: 0.47, run: 0.25, strength: 0.08 };
export const SPLIT_BASE_SHORT: SportSplit = { swim: 0.23, bike: 0.4, run: 0.29, strength: 0.08 };
export const SPLIT_BUILD_HALF: SportSplit = { swim: 0.18, bike: 0.5, run: 0.28, strength: 0.04 };
export const SPLIT_BUILD_FULL: SportSplit = { swim: 0.17, bike: 0.54, run: 0.26, strength: 0.03 };
export const SPLIT_BUILD_SHORT: SportSplit = { swim: 0.22, bike: 0.42, run: 0.32, strength: 0.04 };
export const SPLIT_PEAK: SportSplit = { swim: 0.2, bike: 0.48, run: 0.3, strength: 0.02 };
export const SPLIT_RUN: SportSplit = { swim: 0, bike: 0.1, run: 0.8, strength: 0.1 };

export interface SessionCounts {
  maxHours: number;
  swim: number;
  bike: number;
  run: number;
  strength: number;
}

/** Sessions per sport by weekly hours. [H] §8 */
export const SESSIONS_BY_HOURS: readonly SessionCounts[] = [
  { maxHours: 4, swim: 2, bike: 2, run: 2, strength: 1 },
  { maxHours: 6.5, swim: 2, bike: 2, run: 3, strength: 1 },
  { maxHours: 9, swim: 2, bike: 3, run: 3, strength: 1 },
  { maxHours: 11, swim: 3, bike: 3, run: 3, strength: 2 },
  { maxHours: 13.5, swim: 3, bike: 3, run: 4, strength: 2 },
  { maxHours: Number.POSITIVE_INFINITY, swim: 3, bike: 4, run: 4, strength: 2 },
];

/** Run-only plans: run sessions by hours. [H] §8 */
export const RUN_SESSIONS_BY_HOURS: readonly { maxHours: number; run: number }[] = [
  { maxHours: 4, run: 3 },
  { maxHours: 6.5, run: 4 },
  { maxHours: 8.5, run: 5 },
  // Beyond the table: a 6th run for very high run-only volume. [H]
  { maxHours: Number.POSITIVE_INFINITY, run: 6 },
];

/** Minimum useful session duration (min). [H] §8 */
export const MIN_SESSION_MIN: Readonly<Record<Sport, number>> = {
  swim: 30,
  bike: 45,
  run: 25,
  brick: 50,
  strength: 25,
  mobility: 15,
  other: 20,
  rest: 0,
};

/** Fit margins around a session in a free window (travel, changing). [H] §10.2 L06 */
export const SLOT_MARGIN_MIN: Readonly<Record<Sport, number>> = {
  swim: 30,
  bike: 15,
  run: 10,
  brick: 15,
  strength: 15,
  mobility: 0,
  other: 15,
  rest: 0,
};

/** When planning today, minutes from now before the first proposed start (get ready, get there). [H] */
export const NOW_BUFFER_MIN = 30;

/** L05 alternative (> 12 h, not beginner, no rest day): one easy day with at most this many minutes. [H] §10.2 */
export const EASY_DAY_MAX_MIN = 60;

/** Pre-race sessions (D−1…D−4) of a race early next week are planned this week. [H] §5.4 */
export const PRE_RACE_LOOKAHEAD_DAYS = 4;

/** Minutes after the window opens before the session starts (getting to the pool / gym). [H] */
export const START_OFFSET_MIN: Readonly<Record<Sport, number>> = {
  swim: 15,
  bike: 0,
  run: 0,
  brick: 0,
  strength: 10,
  mobility: 0,
  other: 0,
  rest: 0,
};

/** Long-session caps in build (minutes). [H] §6.3 */
export const LONG_CAPS: Readonly<Record<RaceDistance, { bike: number; run: number }>> = {
  sprint: { bike: 90, run: 60 },
  olympic: { bike: 150, run: 90 },
  half: { bike: 240, run: 120 },
  full: { bike: 360, run: 150 },
  run_5k: { bike: 90, run: 75 },
  run_10k: { bike: 90, run: 90 },
  run_half: { bike: 90, run: 120 },
  run_marathon: { bike: 120, run: 180 },
  other: { bike: 150, run: 90 },
};

/** Share of the sport's weekly time that goes to its long session. [H] §8 */
export const LONG_SHARE = { bike: 0.4, run: 0.35 } as const;

/** Run single-session spike rule (Frandsen 2025). [E] §6.3 */
export const RUN_SPIKE_MAX = 1.1;
export const RUN_SPIKE_FLOOR_KM = 5;
export const RUN_LOOKBACK_DAYS = 30;
export const RUN_WEEKLY_MINUTES_GROWTH = 1.15; // [H] soft warning
/** Bike long-ride growth. [H] §6.3 */
export const BIKE_LONG_GROWTH = 1.15;
export const BIKE_LONG_GROWTH_MIN = 20;

/** Hard points (§10.1). A day with ≥ 1 point is a hard day. [H] */
export const HARD_POINTS = {
  quality: 1,
  long: 1,
  longShort: 0.5,
  brick: 1.5,
  swimQuality: 0.5,
  strengthHeavy: 0.5,
  strengthMaint: 0.25,
  otherEndurance: 0.5,
  otherHard: 1,
  otherHardFootball: 1.5,
  race: 3,
} as const;
export const HARD_DAY_THRESHOLD = 1;
/** Long scaling: long sessions count fully only above these. [H] §10.1 */
export const LONG_SCALING = { runFullMin: 75, runFullIF: 0.8, bikeFullMin: 150, bikeFullIF: 0.75 } as const;

/** Quality (bike + run, brick counts) sessions per week by phase. [H] §2.2 */
export const QUALITY_BUDGET = {
  transition: 0,
  prep: 0,
  base: 2,
  build: 3,
  peak: 2,
  taper: 2,
  race_week: 1,
  recovery: 1,
} as const;

/** Max hard days per week by hours (L08). [H] */
export function maxHardDays(hours: number, isAdvanced: boolean): number {
  if (hours <= 7) return 3;
  if (hours <= 12) return 4;
  return isAdvanced ? 5 : 4;
}

/** Minimum share of weekly time in Z1-Z2 (outside race week). [H] §2.2 */
export const MIN_LOW_INTENSITY_SHARE = 0.75;

// ---------------------------------------------------------------------------
// Re-planning (§11)
// ---------------------------------------------------------------------------

/** Missed session handling. [H] §11.2 */
export const MISSED = { moveWindowLongDays: 2, moveWindowQualityDays: 3, shrinkFactor: 0.6, dayLoadCapFactor: 1.2 } as const;

/** Illness rules. [H] §11.6 */
export const ILLNESS = { feverC: 37.8, aboveNeckDurationFactor: 0.55, minReturnDays: 2, maxReturnDays: 10 } as const;

/**
 * Cardiac red flags (IL5). The block lasts until the athlete records the
 * medical all-clear on the event (title/notes) or, at most, this many days
 * after the event's last day; then a short easy-only return follows. [H]
 * The expiry exists so that loading older events never blocks training forever;
 * the CARDIAC_WARNING keeps asking for a medical check.
 */
export const CARDIAC = { blockDaysAfterEnd: 14, returnDays: 7, returnPhase1Days: 3 } as const;

/** Injury triage. [H] §11.5 */
export const INJURY = { greenVolumeFactor: 0.7, greenDays: 7, amberRestDays: 3, escalateAfterDays: 7 } as const;

/** Run substitution ratios when injured. [H] §11.5 */
export const SUBSTITUTION_RATIO: Readonly<Partial<Record<Sport, number>>> = { bike: 1.3, swim: 1, run: 1 };

/** Sleep / stress / work cuts. [H] §11.7 (no quantitative literature backing) */
export const LIFE_STRESS = {
  stressVolumeFactor: 0.8, // ST1
  workVolumeFactor: [0.8, 0.7, 0.6] as const, // ST2 by severity 1..3
  overloadVolumeFactor: 0.8,
  shortSleepIntervalCut: 0.7, // SL1
} as const;

/** Readiness thresholds. [E]/[H] §11.8 */
export const READINESS = {
  trRed: 25,
  trAmber: 50,
  rhrAmber: 5,
  rhrRed: 8,
  hrvSwcSd: 0.5,
  sleepAmberHours: 6,
  sleepScoreAmber: 60,
  sleepWeekAvgHours: 6.5, // SL3 [H]
  minBaselineDays: 7,
} as const;

/** Readiness effects on sessions. [H] §11.8 */
export const READINESS_EFFECTS = {
  amberQualityCut: 0.7, // interval work −25-50 % → whole session ×0.7
  amberLongCut: 0.8,
  redMaxEasyMin: 45,
  plannerRedWeekFactor: 0.9,
  plannerAmberWeekFactor: 0.95,
} as const;

/** Travel. [H] §11.9 */
export const TRAVEL = { travelDayMaxMin: 45, noBikeRunShare: 0.5, noPoolStrengthMin: 30 } as const;

/** Other sports (pádel, fútbol…) estimates when no HR data. [H]/[E] §11.4 */
export interface OtherSportProfile {
  /** Session IF by severity 1..3. */
  ifBySeverity: readonly [number, number, number];
  defaultDurationMin: number;
  /** Hard points by severity 1..3. */
  hardPointsBySeverity: readonly [number, number, number];
  /** Hours after the event without any running. */
  noRunHours: number;
  /** Hours after the event without run QUALITY/LONG. */
  noRunQualityHours: number;
}

export const OTHER_SPORT_PROFILES: Readonly<Record<'padel' | 'football' | 'other_sport', OtherSportProfile>> = {
  // Pádel always counts as a hard session for our users (product decision over §11.4's ENDURANCE default). [H]
  padel: { ifBySeverity: [0.7, 0.76, 0.82], defaultDurationMin: 90, hardPointsBySeverity: [1, 1, 1], noRunHours: 0, noRunQualityHours: 24 },
  football: { ifBySeverity: [0.82, 0.86, 0.9], defaultDurationMin: 90, hardPointsBySeverity: [1, 1.5, 1.5], noRunHours: 24, noRunQualityHours: 48 },
  other_sport: { ifBySeverity: [0.62, 0.72, 0.84], defaultDurationMin: 60, hardPointsBySeverity: [0.5, 0.5, 1], noRunHours: 0, noRunQualityHours: 24 },
};

// ---------------------------------------------------------------------------
// Safety copy (§11.5, §11.6, §12) — always shown in the relevant flows
// ---------------------------------------------------------------------------

export const INJURY_DISCLAIMER =
  'Esto es una ayuda para organizar tu entrenamiento, no un diagnóstico. Si el dolor es intenso, va a más, no mejora en 7-10 días o aparece alguna señal de alarma, para y consulta a un profesional (médico o fisioterapeuta).';

export const CARDIAC_WARNING =
  'Con dolor en el pecho, palpitaciones, mareo o falta de aire, no entrenes: consulta a un médico, idealmente un cardiólogo, antes de volver.';

export const FUELING_DISCLAIMER =
  'Pautas generales para deportistas sanos; no sustituyen a un dietista-nutricionista ni a tu médico.';
