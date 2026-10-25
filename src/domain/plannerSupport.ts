/**
 * Helpers for the weekly planner: progression caps from history (Frandsen
 * run rule, long-ride growth), ramp-rate cap, matching existing workouts to
 * the ideal week, trimming to the minutes budget, race-week sessions.
 */
import {
  BIKE_LONG_GROWTH,
  BIKE_LONG_GROWTH_MIN,
  GENERIC_TSS_PER_HOUR,
  MIN_SESSION_MIN,
  RAMP_HARD_CAP,
  RAMP_LIFE_STRESS_PENALTY,
  RAMP_TABLE,
  RUN_LOOKBACK_DAYS,
  RUN_SPIKE_FLOOR_KM,
  RUN_SPIKE_MAX,
  TSB_FLOOR,
  TSB_WARN,
  type DistanceKind,
} from './constants';
import { addDays } from './dates';
import { computePmc, dailyLoads, estimateTss, weeklyLoadForRamp } from './load';
import type { Placed } from './placement';
import { specClass, specIntensity, specSport, type SessionSpec } from './sessions';
import type { AthleteLevel, ISODate, Race, RaceDistance, Thresholds, Workout } from './types';
import type { FixedInput } from './weekModel';

export interface HistoryCaps {
  runLongMax: number | null;
  bikeLongMax: number | null;
  /** Minutes per km at easy pace (for distance estimates). */
  runPaceMinPerKm: number | null;
  /** Longest run of the lookback window in metres. */
  longestRunM: number | null;
}

function doneMinutes(w: Workout): number {
  return w.completed?.durationMin ?? w.durationMin;
}

function doneDistance(w: Workout): number | null {
  return w.completed?.distanceM ?? w.distanceM ?? null;
}

/** §6.3: run ≤ 1.10 × longest run of the last 30 days (5 km floor); long ride ≤ max(1.15×, +20'). */
export function historyCaps(history: readonly Workout[], weekStart: ISODate, thresholds: Thresholds): HistoryCaps {
  const from = addDays(weekStart, -RUN_LOOKBACK_DAYS);
  const recent = history.filter((w) => w.status === 'completed' && w.date >= from && w.date < weekStart);
  const runs = recent.filter((w) => w.sport === 'run');
  const longestRun = runs.reduce<Workout | null>((best, w) => ((doneDistance(w) ?? 0) > (best ? (doneDistance(best) ?? 0) : 0) ? w : best), null);
  const longestRunM = longestRun ? doneDistance(longestRun) : null;
  const historyPace = longestRun && longestRunM && longestRunM > 0 ? doneMinutes(longestRun) / (longestRunM / 1000) : null;
  const thresholdPace = thresholds.runThresholdPaceSecPerKm ? (thresholds.runThresholdPaceSecPerKm * 1.2) / 60 : null;
  const pace = historyPace && historyPace > 3 && historyPace < 12 ? historyPace : thresholdPace;
  const maxKm = longestRunM && longestRunM > 0 ? Math.max(RUN_SPIKE_FLOOR_KM, (RUN_SPIKE_MAX * longestRunM) / 1000) : null;
  const runLongMax = maxKm !== null && pace !== null ? Math.floor((maxKm * pace) / 5) * 5 : null;
  const rides = recent.filter((w) => w.sport === 'bike' || w.sport === 'brick').map(doneMinutes);
  const longestRide = rides.length > 0 ? Math.max(...rides) : null;
  const bikeLongMax = longestRide ? Math.floor(Math.max(longestRide * BIKE_LONG_GROWTH, longestRide + BIKE_LONG_GROWTH_MIN) / 5) * 5 : null;
  return { runLongMax, bikeLongMax, runPaceMinPerKm: pace, longestRunM };
}

export interface RampInput {
  recentWeeklyMinutes: readonly number[] | undefined;
  level: AthleteLevel;
  lifeStress: boolean;
}

/** §4.2 ramp control expressed in weekly minutes; null when there is no history. */
export function rampCapMinutes(input: RampInput): number | null {
  const weeks = (input.recentWeeklyMinutes ?? []).filter((m) => Number.isFinite(m) && m >= 0);
  if (weeks.length < 2 || weeks.every((m) => m === 0)) return null;
  const avgMin = weeks.reduce((s, m) => s + m, 0) / weeks.length;
  const ctl = ((avgMin / 60) * GENERIC_TSS_PER_HOUR) / 7;
  const row = RAMP_TABLE.find((r) => ctl <= r.maxCtl) ?? RAMP_TABLE[RAMP_TABLE.length - 1];
  const base = input.level === 'beginner' || input.lifeStress ? (row?.low ?? 3) : (row?.moderate ?? 6);
  const ramp = Math.max(1, Math.min(RAMP_HARD_CAP, base - (input.lifeStress ? RAMP_LIFE_STRESS_PENALTY : 0)));
  return Math.round((weeklyLoadForRamp(ctl, ramp) / GENERIC_TSS_PER_HOUR) * 60);
}

function roleOf(spec: SessionSpec): 'quality' | 'long' | 'easy' {
  const cls = specClass(spec);
  if (cls === 'QUALITY' || cls === 'BRICK') return 'quality';
  if (cls === 'LONG') return 'long';
  return 'easy';
}

function existingRole(f: FixedInput, longThreshold: number): 'quality' | 'long' | 'easy' {
  if (['tempo', 'threshold', 'vo2', 'race'].includes(f.intensity) || f.sport === 'brick') return 'quality';
  return f.durationMin >= longThreshold ? 'long' : 'easy';
}

function sameSportFamily(spec: SessionSpec, f: FixedInput): boolean {
  const sport = specSport(spec);
  if (sport === f.sport) return true;
  return f.sport === 'brick' && (spec.code === 'BK_LONG' || sport === 'bike');
}

/** Removes from the ideal week the sessions already covered by existing workouts / quedadas. */
export function consumeExisting(specs: readonly SessionSpec[], existing: readonly FixedInput[]): SessionSpec[] {
  let remaining = [...specs];
  const ordered = [...existing].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? '').localeCompare(b.id ?? ''));
  for (const f of ordered) {
    const sameSport = remaining.filter((s) => sameSportFamily(s, f) && specClass(s) !== 'RACE');
    if (sameSport.length === 0) continue;
    const longSpec = sameSport.find((s) => roleOf(s) === 'long');
    const role = existingRole(f, longSpec ? longSpec.durationMin * 0.8 : 90);
    const match =
      sameSport.find((s) => roleOf(s) === role) ??
      [...sameSport].sort((a, b) => b.priority - a.priority || a.durationMin - b.durationMin)[0];
    if (match) remaining = remaining.filter((s) => s !== match);
  }
  return remaining;
}

function total(specs: readonly SessionSpec[]): number {
  return specs.reduce((s, x) => s + x.durationMin, 0);
}

function canShorten(s: SessionSpec, floor: number): boolean {
  return !s.allowedDates && s.durationMin - 5 >= Math.max(MIN_SESSION_MIN[specSport(s)] ?? 20, floor);
}

/**
 * Fits the sessions into the minutes budget: shortens easy sessions to their
 * minimum, then key sessions down to 75 %, and only then drops the least
 * important ones.
 */
export function trimToBudget(specs: readonly SessionSpec[], budget: number): SessionSpec[] {
  let items = specs.map((spec) => ({ spec, original: spec.durationMin }));
  const sum = () => total(items.map((x) => x.spec));
  for (let guard = 0; sum() > budget && guard < 400; guard += 1) {
    const easy = items
      .filter((x) => x.spec.priority >= 5 && canShorten(x.spec, 0))
      .sort((a, b) => b.spec.durationMin - a.spec.durationMin || b.spec.priority - a.spec.priority)[0];
    const key = items
      .filter((x) => x.spec.priority < 5 && canShorten(x.spec, x.original * 0.75))
      .sort((a, b) => b.spec.priority - a.spec.priority || b.spec.durationMin - a.spec.durationMin)[0];
    const target = easy ?? key;
    if (target) {
      items = items.map((x) => (x === target ? { ...x, spec: { ...x.spec, durationMin: x.spec.durationMin - 5 } } : x));
      continue;
    }
    const victim = items.filter((x) => !x.spec.allowedDates).sort((a, b) => b.spec.priority - a.spec.priority || a.spec.durationMin - b.spec.durationMin)[0];
    if (!victim) break;
    items = items.filter((x) => x !== victim);
  }
  return items.map((x) => x.spec);
}

export interface TsbGuardInput {
  range: { from: ISODate; to: ISODate };
  history: readonly Workout[];
  recentWeeklyMinutes?: readonly number[];
  /** Load of existing workouts and other sports per day of the week. */
  fixedLoads: Readonly<Record<ISODate, number>>;
  placed: readonly Placed[];
}

export interface TsbGuardResult {
  placed: Placed[];
  removed: Placed[];
  minTsb: number | null;
  warning: string | null;
}

function pmcSeed(input: TsbGuardInput): { ctl: number; atl: number } | null {
  const completed = input.history.filter((w) => w.status === 'completed' && w.date < input.range.from);
  if (completed.length > 0) {
    const from = addDays(input.range.from, -60);
    const loads = dailyLoads(completed, [], { from, to: addDays(input.range.from, -1) });
    const last = computePmc(loads, { from, to: addDays(input.range.from, -1) }).at(-1);
    return last ? { ctl: last.ctl, atl: last.atl } : null;
  }
  const weeks = (input.recentWeeklyMinutes ?? []).filter((m) => Number.isFinite(m) && m > 0);
  if (weeks.length < 2) return null;
  const daily = ((weeks.reduce((s, m) => s + m, 0) / weeks.length / 60) * GENERIC_TSS_PER_HOUR) / 7;
  return { ctl: daily, atl: daily };
}

function projectedTsb(input: TsbGuardInput, placed: readonly Placed[], seed: { ctl: number; atl: number }): number[] {
  const loads: Record<ISODate, number> = { ...input.fixedLoads };
  for (const p of placed) {
    const sport = specSport(p.spec);
    loads[p.date] = (loads[p.date] ?? 0) + estimateTss({ sport, durationMin: p.spec.durationMin, intensity: specIntensity(p.spec) });
  }
  return computePmc(loads, { from: input.range.from, to: addDays(input.range.to, 1) }, seed).map((p) => p.tsb);
}

/** Extra freshness a plan may take on a day that is already below the floor because of past training. [H] */
const PAST_FATIGUE_TOLERANCE = 3;

/** A day breaks L11 when the plan pushes it below −30 (or clearly below what resting alone would give). */
function violates(withPlan: readonly number[], rest: readonly number[]): boolean {
  return withPlan.some((tsb, i) => {
    const restTsb = rest[i] ?? 0;
    const tolerance = restTsb < TSB_FLOOR + PAST_FATIGUE_TOLERANCE ? PAST_FATIGUE_TOLERANCE : 0.5;
    return tsb < Math.min(TSB_FLOOR, restTsb) - tolerance;
  });
}

/** L11: projected freshness never below −30 (drops the least important sessions); warns below −20. */
export function tsbGuard(input: TsbGuardInput): TsbGuardResult {
  const seed = pmcSeed(input);
  if (!seed) return { placed: [...input.placed], removed: [], minTsb: null, warning: null };
  const rest = projectedTsb(input, [], seed);
  let placed = [...input.placed];
  const removed: Placed[] = [];
  let tsb = projectedTsb(input, placed, seed);
  while (violates(tsb, rest)) {
    const victim = placed.filter((p) => specClass(p.spec) !== 'RACE' && !p.spec.allowedDates).sort((a, b) => b.spec.priority - a.spec.priority || a.spec.durationMin - b.spec.durationMin)[0];
    if (!victim) break;
    placed = placed.filter((p) => p !== victim);
    removed.push(victim);
    tsb = projectedTsb(input, placed, seed);
  }
  const minTsb = Math.min(...tsb);
  const warning = minTsb < TSB_WARN ? 'Acumulas bastante fatiga: esta semana no subimos más la carga.' : null;
  return { placed, removed, minTsb: Math.round(minTsb * 10) / 10, warning };
}

const RACE_DURATION: Record<RaceDistance, number> = {
  sprint: 80,
  olympic: 150,
  half: 330,
  full: 720,
  run_5k: 30,
  run_10k: 55,
  run_half: 120,
  run_marathon: 260,
  other: 120,
};

/**
 * Keeps only the allowed dates inside [from, to] and leaves out pinned
 * sessions without any date left (e.g. the D−3 spark of a Monday race when
 * planning the race week). Unpinned specs are kept as they are.
 */
export function narrowToWeek(specs: readonly SessionSpec[], from: ISODate, to: ISODate): SessionSpec[] {
  return specs.flatMap((s) => {
    if (!s.allowedDates) return [s];
    const allowedDates = s.allowedDates.filter((d) => d >= from && d <= to);
    if (allowedDates.length === 0) return [];
    return [allowedDates.length === s.allowedDates.length ? s : { ...s, allowedDates }];
  });
}

/** Race day + race-week activations (§5.4 race-week rules). */
export function raceWeekSessions(race: Race, isTarget: boolean, kind: DistanceKind, firstPlannable: ISODate): SessionSpec[] {
  if (race.date < firstPlannable) return [];
  const isRun = kind === 'run' || race.distance.startsWith('run_');
  const raceSpec: SessionSpec = {
    code: 'RACE',
    durationMin: RACE_DURATION[race.distance],
    priority: 0,
    raceName: race.name,
    sport: isRun ? 'run' : 'brick',
    allowedDates: [race.date],
  };
  if (!isTarget && race.priority === 'C') return [raceSpec];
  const dMinus = (n: number) => addDays(race.date, -n);
  const activation: SessionSpec = { code: 'ACTIVATION', durationMin: 25, priority: 2, sport: isRun ? 'run' : 'bike', allowedDates: [dMinus(1)] };
  if (!isTarget) return [raceSpec, activation];
  const spark: SessionSpec = isRun
    ? { code: 'RN_THR', durationMin: 40, priority: 2, allowedDates: [dMinus(3), dMinus(4)], note: 'Última sesión con chispa antes de la carrera: corta y sin fatiga.' }
    : { code: 'BRICK', durationMin: 45, brickRunMin: 10, racePace: true, priority: 2, allowedDates: [dMinus(3), dMinus(4)], note: 'Última sesión con chispa antes de la carrera.' };
  const easySwim: SessionSpec[] = isRun ? [] : [{ code: 'SW_TECH', durationMin: 30, priority: 5, allowedDates: [dMinus(2)], note: 'Solo para soltar: nada de cansarse.' }];
  return [raceSpec, activation, spark, ...easySwim];
}
