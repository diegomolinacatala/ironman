/**
 * Pure helpers that turn Apple Health (HealthKit) samples into Road to Ironman domain
 * data. No React Native / HealthKit imports here so everything is unit-testable.
 *
 * Raw numeric values mirror `WorkoutActivityType` and `CategoryValueSleepAnalysis`
 * from `@kingstinct/react-native-healthkit` (HKWorkoutActivityType / HKCategoryValueSleepAnalysis).
 */
import type { ISODate, MetricsDraft, Sport } from '@/domain/types';

import { localDate } from '../time';

export { localDate, localTime } from '../time';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Sleep samples ending before 18:00 belong to that day; later ones to the next morning. */
const SLEEP_DAY_SHIFT_MS = 6 * HOUR_MS;
const MAX_SLEEP_HOURS = 16;
/** Activities shorter than this are noise (warm-up walks, accidental starts). */
export const MIN_ACTIVITY_MINUTES = 10;
/** Same limit the domain uses for workout drafts. */
export const MAX_ACTIVITY_MINUTES = 12 * 60;

export interface HealthActivityKind {
  sport: Sport;
  /** Spanish title for an imported (unplanned) workout. */
  title: string;
}

const RUN: HealthActivityKind = { sport: 'run', title: 'Carrera' };
const BIKE: HealthActivityKind = { sport: 'bike', title: 'Ciclismo' };
const SWIM: HealthActivityKind = { sport: 'swim', title: 'Natación' };
const STRENGTH: HealthActivityKind = { sport: 'strength', title: 'Fuerza' };
const MOBILITY: HealthActivityKind = { sport: 'mobility', title: 'Movilidad' };
const RACKET: HealthActivityKind = { sport: 'other', title: 'Pádel / raqueta' };

/**
 * HKWorkoutActivityType raw value → sport. `null` = ignored (not training).
 * There is no "padel" type in HealthKit: Garmin padel usually lands as
 * tennis/racquetball/other, all mapped to `other` like football.
 */
const ACTIVITY_TABLE: Readonly<Record<number, HealthActivityKind | null>> = {
  37: RUN, // running
  49: { sport: 'run', title: 'Atletismo' }, // trackAndField
  71: RUN, // wheelchairRunPace
  13: BIKE, // cycling
  74: BIKE, // handCycling
  46: SWIM, // swimming
  82: { sport: 'brick', title: 'Multideporte' }, // swimBikeRun
  83: null, // transition (segment of a multisport session)
  50: STRENGTH, // traditionalStrengthTraining
  20: { sport: 'strength', title: 'Fuerza funcional' }, // functionalStrengthTraining
  59: { sport: 'strength', title: 'Core' }, // coreTraining
  11: { sport: 'strength', title: 'Entreno cruzado' }, // crossTraining
  63: { sport: 'strength', title: 'HIIT' }, // highIntensityIntervalTraining
  57: { sport: 'mobility', title: 'Yoga' }, // yoga
  66: { sport: 'mobility', title: 'Pilates' }, // pilates
  62: MOBILITY, // flexibility
  29: MOBILITY, // mindAndBody
  33: MOBILITY, // preparationAndRecovery
  80: MOBILITY, // cooldown
  72: MOBILITY, // taiChi
  58: MOBILITY, // barre
  41: { sport: 'other', title: 'Fútbol' }, // soccer
  48: { sport: 'other', title: 'Tenis' }, // tennis
  34: RACKET, // racquetball
  43: RACKET, // squash
  79: RACKET, // pickleball
  4: RACKET, // badminton
  47: RACKET, // tableTennis
  6: { sport: 'other', title: 'Baloncesto' }, // basketball
  35: { sport: 'other', title: 'Remo' }, // rowing
  31: { sport: 'other', title: 'Piragüismo' }, // paddleSports (kayak, not padel)
  24: { sport: 'other', title: 'Senderismo' }, // hiking
  16: { sport: 'other', title: 'Elíptica' }, // elliptical
  44: { sport: 'other', title: 'Escaleras' }, // stairClimbing
  52: null, // walking: daily life, not training
  70: null, // wheelchairWalkPace
  2998: null, // rest
};

const DEFAULT_KIND: HealthActivityKind = { sport: 'other', title: 'Actividad' };

/** Maps an HKWorkoutActivityType raw value to a sport, or null when it should not be imported. */
export function mapHealthActivity(activityType: number): HealthActivityKind | null {
  if (Object.prototype.hasOwnProperty.call(ACTIVITY_TABLE, activityType)) {
    return ACTIVITY_TABLE[activityType] ?? null;
  }
  return DEFAULT_KIND;
}

export interface QuantityLike {
  quantity: number;
  unit: string;
}

const TIME_UNIT_TO_MIN: Readonly<Record<string, number>> = {
  ms: 1 / 60_000,
  s: 1 / 60,
  min: 1,
  hr: 60,
  h: 60,
  d: 1440,
};

const LENGTH_UNIT_TO_M: Readonly<Record<string, number>> = {
  m: 1,
  km: 1000,
  cm: 0.01,
  mi: 1609.344,
  yd: 0.9144,
  ft: 0.3048,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Converts a HealthKit time quantity to minutes (null when unknown/invalid). */
export function quantityToMinutes(q: QuantityLike | null | undefined): number | null {
  if (!q || !isFiniteNumber(q.quantity)) return null;
  const factor = TIME_UNIT_TO_MIN[q.unit];
  return factor === undefined ? null : q.quantity * factor;
}

/** Converts a HealthKit length quantity to metres (null when unknown/invalid). */
export function quantityToMeters(q: QuantityLike | null | undefined): number | null {
  if (!q || !isFiniteNumber(q.quantity)) return null;
  const factor = LENGTH_UNIT_TO_M[q.unit];
  return factor === undefined ? null : q.quantity * factor;
}

const ENERGY_UNIT_TO_KCAL: Readonly<Record<string, number>> = {
  kcal: 1,
  Cal: 1,
  cal: 0.001,
  kJ: 1 / 4.184,
  J: 1 / 4184,
};

/** Converts a HealthKit energy quantity (a workout's `totalEnergyBurned`) to kcal; null when unknown/invalid. */
export function quantityToKcal(q: QuantityLike | null | undefined): number | null {
  if (!q || !isFiniteNumber(q.quantity) || q.quantity <= 0) return null;
  const factor = ENERGY_UNIT_TO_KCAL[q.unit];
  return factor === undefined ? null : q.quantity * factor;
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

/** HKCategoryValueSleepAnalysis values that count as asleep (unspecified, core, deep, REM). */
export const ASLEEP_VALUES: readonly number[] = [1, 3, 4, 5];

export interface SleepSampleLike {
  startDate: Date;
  endDate: Date;
  value: number;
}

interface Interval {
  start: number;
  end: number;
}

function unionMs(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | null = null;
  for (const iv of sorted) {
    if (!current || iv.start > current.end) {
      if (current) total += current.end - current.start;
      current = { ...iv };
    } else if (iv.end > current.end) {
      current = { start: current.start, end: iv.end };
    }
  }
  return current ? total + (current.end - current.start) : total;
}

/** Asleep intervals grouped by "wake-up" date (samples ending before 18:00 belong to that day). */
function asleepByDate(samples: readonly SleepSampleLike[]): Map<ISODate, Interval[]> {
  const byDate = new Map<ISODate, Interval[]>();
  for (const s of samples) {
    if (!ASLEEP_VALUES.includes(s.value)) continue;
    const start = s.startDate.getTime();
    const end = s.endDate.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const date = localDate(new Date(end + SLEEP_DAY_SHIFT_MS));
    byDate.set(date, [...(byDate.get(date) ?? []), { start, end }]);
  }
  return byDate;
}

/**
 * Hours asleep per "wake-up" date. Overlapping samples from several sources
 * (iPhone + Garmin + Watch) are merged so the same night is not counted twice.
 */
export function sleepHoursByDate(samples: readonly SleepSampleLike[]): Record<ISODate, number> {
  const result: Record<ISODate, number> = {};
  for (const [date, intervals] of asleepByDate(samples)) {
    const hours = Math.min(MAX_SLEEP_HOURS, unionMs(intervals) / HOUR_MS);
    result[date] = Math.round(hours * 100) / 100;
  }
  return result;
}

export interface SleepWindow {
  start: Date;
  end: Date;
}

/** Asleep intervals closer than this belong to the same block (night awakenings); farther apart, a nap. */
const SLEEP_BLOCK_GAP_MS = 90 * MINUTE_MS;

function sleepBlocks(intervals: readonly Interval[]): Interval[][] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const blocks: Interval[][] = [];
  let end = Number.NEGATIVE_INFINITY;
  for (const iv of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && iv.start - end <= SLEEP_BLOCK_GAP_MS) last.push(iv);
    else blocks.push([iv]);
    end = Math.max(end, iv.end);
  }
  return blocks;
}

/**
 * The main sleep of each "wake-up" date, first to last asleep minute (a nap on
 * the same date is left out). Heart rate and breathing during sleep are read
 * inside this window.
 */
export function sleepWindowsByDate(samples: readonly SleepSampleLike[]): Record<ISODate, SleepWindow> {
  const result: Record<ISODate, SleepWindow> = {};
  for (const [date, intervals] of asleepByDate(samples)) {
    const main = sleepBlocks(intervals).reduce<Interval[] | null>((best, block) => (best === null || unionMs(block) > unionMs(best) ? block : best), null);
    if (!main || main.length === 0) continue;
    const start = Math.min(...main.map((iv) => iv.start));
    const end = Math.max(...main.map((iv) => iv.end));
    if (end - start > MAX_SLEEP_HOURS * HOUR_MS) continue;
    result[date] = { start: new Date(start), end: new Date(end) };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Daily statistics → MetricsDraft
// ---------------------------------------------------------------------------

export interface DailyStatLike {
  startDate?: Date;
  quantity?: QuantityLike;
}

/** Statistics-collection buckets (one per day) → value per local date. */
export function statsByDate(stats: readonly DailyStatLike[]): Record<ISODate, number> {
  const result: Record<ISODate, number> = {};
  for (const s of stats) {
    if (!s.startDate || !s.quantity || !isFiniteNumber(s.quantity.quantity)) continue;
    result[localDate(s.startDate)] = s.quantity.quantity;
  }
  return result;
}

export interface DailyHealthSeries {
  sleepHours: Record<ISODate, number>;
  restingHr: Record<ISODate, number>;
  hrvMs: Record<ISODate, number>;
  steps: Record<ISODate, number>;
  vo2max: Record<ISODate, number>;
  /** Average breathing rate (breaths/min) and heart rate (bpm) inside each night's sleep window. */
  sleepRespiration?: Record<ISODate, number>;
  sleepAvgHr?: Record<ISODate, number>;
}

function round1(value: number | undefined): number | null {
  return isFiniteNumber(value) ? Math.round(value * 10) / 10 : null;
}

/**
 * Night vitals, only when they were read: then every draft carries both keys
 * (null when that night has none) so the batched upsert writes the same columns.
 */
function nightVitals(series: DailyHealthSeries, date: ISODate): Pick<MetricsDraft, 'sleepRespiration' | 'sleepAvgHr'> {
  if (!series.sleepRespiration && !series.sleepAvgHr) return {};
  return { sleepRespiration: round1(series.sleepRespiration?.[date]), sleepAvgHr: round1(series.sleepAvgHr?.[date]) };
}

/** One `MetricsDraft` (source 'healthkit') per date that has at least one value. */
export function buildMetricsDrafts(dates: readonly ISODate[], series: DailyHealthSeries): MetricsDraft[] {
  return dates.flatMap((date): MetricsDraft[] => {
    const steps = series.steps[date];
    const draft: MetricsDraft = {
      date,
      source: 'healthkit',
      hrvMs: round1(series.hrvMs[date]),
      restingHr: round1(series.restingHr[date]),
      sleepHours: isFiniteNumber(series.sleepHours[date]) ? (series.sleepHours[date] ?? null) : null,
      sleepScore: null,
      bodyBattery: null,
      trainingReadiness: null,
      vo2max: round1(series.vo2max[date]),
      steps: isFiniteNumber(steps) && steps > 0 ? Math.round(steps) : null,
      stressAvg: null,
      trainingStatus: null,
      ...nightVitals(series, date),
    };
    const hasValue =
      draft.hrvMs != null ||
      draft.restingHr != null ||
      draft.sleepHours != null ||
      draft.vo2max != null ||
      draft.steps != null ||
      draft.sleepRespiration != null ||
      draft.sleepAvgHr != null;
    return hasValue ? [draft] : [];
  });
}
