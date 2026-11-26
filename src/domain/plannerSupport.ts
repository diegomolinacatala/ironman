/**
 * Helpers for the weekly planner: progression caps from history (Frandsen
 * run rule, long-ride growth), ramp-rate cap, matching existing workouts to
 * the ideal week, trimming to the minutes budget and to the weekly run cap, the Z1-Z2 share, race-week
 * sessions and the week-level override (Plan → General). Shared with the
 * season overview (seasonSessions.ts) so both show the same weeks.
 */
import {
  BIKE_LONG_GROWTH,
  BIKE_LONG_GROWTH_MIN,
  GENERIC_TSS_PER_HOUR,
  MIN_LOW_INTENSITY_SHARE,
  PRE_RACE_LOOKAHEAD_DAYS,
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
import { addDays, diffDays, formatDuration } from './dates';
import { computePmc, dailyLoads, estimateTss, weeklyLoadForRamp } from './load';
import { racePrepOf, type PhaseInfo, type SpecificPrep } from './periodization';
import type { Placed } from './placement';
import { canOverride } from './season';
import { buildSession, hardMinutes, isQualitySpec, specClass, specIntensity, specSport, type SessionCode, type SessionSpec } from './sessions';
import { trimSelected } from './trim';
import type { AthleteLevel, ISODate, Race, RaceDistance, Sport, Thresholds, WeekPlan, WeekPlanKind, Workout } from './types';
import type { FixedInput } from './weekModel';

/** Fits the sessions into the minutes budget (easy first, then key ones to 75 %, then drops); lives in trim.ts. */
export { trimToBudget } from './trim';

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

/**
 * Week-on-week volume growth over the biggest recent week: +20 % at most
 * (+15 % for beginners, +10 % under life stress), the rule the AI coach also follows.
 */
const VOLUME_GROWTH = 1.2;
const VOLUME_GROWTH_BEGINNER = 1.15;
const VOLUME_GROWTH_STRESS = 1.1;
/** At very low volumes a percentage is too tight: always allow this many extra minutes. */
const VOLUME_GROWTH_MIN_EXTRA = 15;
/** Weeks (most recent) whose peak the volume cap grows from. */
const VOLUME_PEAK_WEEKS = 3;

/**
 * §4.2 ramp control expressed in weekly minutes; null when there is no history.
 * Two caps, the tighter wins: the CTL ramp (points of fitness per week) and plain
 * volume growth over the biggest of the last 3 weeks. From a low CTL the CTL ramp
 * alone allowed almost doubling the week (300' → ~600').
 * `recentWeeklyMinutes` is oldest first.
 */
export function rampCapMinutes(input: RampInput): number | null {
  const weeks = (input.recentWeeklyMinutes ?? []).filter((m) => Number.isFinite(m) && m >= 0);
  if (weeks.length < 2 || weeks.every((m) => m === 0)) return null;
  const careful = input.level === 'beginner' || input.lifeStress;
  const avgMin = weeks.reduce((s, m) => s + m, 0) / weeks.length;
  const ctl = ((avgMin / 60) * GENERIC_TSS_PER_HOUR) / 7;
  const row = RAMP_TABLE.find((r) => ctl <= r.maxCtl) ?? RAMP_TABLE[RAMP_TABLE.length - 1];
  const base = careful ? (row?.low ?? 3) : (row?.moderate ?? 6);
  const ramp = Math.max(1, Math.min(RAMP_HARD_CAP, base - (input.lifeStress ? RAMP_LIFE_STRESS_PENALTY : 0)));
  const ctlCap = Math.round((weeklyLoadForRamp(ctl, ramp) / GENERIC_TSS_PER_HOUR) * 60);
  const peak = Math.max(...weeks.slice(-VOLUME_PEAK_WEEKS));
  if (peak <= 0) return ctlCap;
  const growth = input.lifeStress ? VOLUME_GROWTH_STRESS : input.level === 'beginner' ? VOLUME_GROWTH_BEGINNER : VOLUME_GROWTH;
  const volumeCap = Math.round(Math.max(peak * growth, peak + VOLUME_GROWTH_MIN_EXTRA));
  return Math.min(ctlCap, volumeCap);
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

/** Run minutes of a session: a whole run, a brick's run leg (from its steps), 0 for other sports. */
export function specRunMinutes(spec: SessionSpec): number {
  const sport = specSport(spec);
  if (sport === 'run') return spec.durationMin;
  if (sport !== 'brick') return 0;
  return buildSession(spec)
    .steps.filter((s) => s.leg === 'run')
    .reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

/**
 * Weekly run cap on the new sessions (runVolume.ts). `room` = the run minutes
 * the week still allows after the running already done, planned or pinned
 * (race week); null = no cap. Over it, runs get shorter (easy ones to their
 * minimum first, then long and quality ones down to 75 %) and the least
 * important are dropped; distance estimates follow the new durations. Bricks
 * and pinned sessions stay as they are. `trimmed` = run minutes taken out.
 */
export function capRunSpecs(specs: readonly SessionSpec[], room: number | null): { specs: SessionSpec[]; trimmed: number } {
  if (room === null) return { specs: [...specs], trimmed: 0 };
  const trimmable = (s: SessionSpec) => specSport(s) === 'run' && !s.allowedDates;
  const others = specs.filter((s) => !trimmable(s)).reduce((sum, s) => sum + specRunMinutes(s), 0);
  return trimSelected(specs, trimmable, room - others, withDistanceOf);
}

/** A shortened run keeps its pace: the distance estimate follows the new duration. */
function withDistanceOf(next: SessionSpec, original: SessionSpec): SessionSpec {
  if (!original.distanceM || original.durationMin <= 0) return next;
  return { ...next, distanceM: Math.round((original.distanceM * next.durationMin) / original.durationMin / 100) * 100 };
}

const ENDURANCE_SPORTS: readonly Sport[] = ['swim', 'bike', 'run', 'brick'];

/** Share of endurance time in Z1-Z2 (by step durations). */
export function lowIntensityShare(specs: readonly SessionSpec[]): number {
  const endurance = specs.filter((s) => ENDURANCE_SPORTS.includes(specSport(s)) && specClass(s) !== 'RACE');
  const totalMin = endurance.reduce((s, x) => s + x.durationMin, 0);
  if (totalMin === 0) return 1;
  return 1 - endurance.reduce((s, x) => s + hardMinutes(x), 0) / totalMin;
}

const EASY_VERSION: Partial<Record<Sport, SessionSpec['code']>> = { bike: 'BK_END', run: 'RN_EASY', swim: 'SW_END' };

function leastImportant(specs: readonly SessionSpec[]): SessionSpec | undefined {
  return [...specs].sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code))[0];
}

/**
 * One step easier: the least important quality session becomes Z2, else the
 * race-pace blocks of a long session or brick become plain Z2. Sessions of a
 * «Preparación específica» (`specificFor`) only once nothing else is left.
 */
function easierStep(specs: readonly SessionSpec[]): SessionSpec[] | null {
  for (const specific of [false, true]) {
    const pool = specs.filter((s) => Boolean(s.specificFor) === specific && !s.allowedDates);
    const quality = leastImportant(pool.filter((s) => isQualitySpec(s) && specClass(s) !== 'BRICK' && EASY_VERSION[specSport(s)]));
    const code = quality ? EASY_VERSION[specSport(quality)] : undefined;
    if (quality && code) return specs.map((s) => (s === quality ? { ...s, code, priority: Math.max(s.priority, 5), specificFor: null } : s));
    const paced = leastImportant(pool.filter((s) => s.racePace));
    if (paced) return specs.map((s) => (s === paced ? { ...s, racePace: false, specificFor: null } : s));
  }
  return null;
}

/** Keeps Z1-Z2 ≥ 75 % of endurance time (§2.2 invariant) by downgrading the least important quality sessions. */
export function enforceIntensityDistribution(specs: readonly SessionSpec[], raceWeek: boolean): SessionSpec[] {
  if (raceWeek) return [...specs];
  let out = [...specs];
  while (lowIntensityShare(out) < MIN_LOW_INTENSITY_SHARE) {
    const next = easierStep(out);
    if (!next) break;
    out = next;
  }
  return out;
}

/** Quality sessions that become race-pace sets for a 'specific' race. */
const RACE_PACE_VERSION: Partial<Record<SessionCode, SessionCode>> = {
  BK_TEMPO: 'BK_RP',
  BK_SST: 'BK_RP',
  BK_THR: 'BK_RP',
  BK_VO2: 'BK_RP',
  RN_TEMPO: 'RN_RP',
  RN_THR: 'RN_RP',
  RN_VO2: 'RN_RP',
  RN_HILLS: 'RN_RP',
};

/** Short race-pace bricks first, then bike quality, then run quality: the most race-like work first. */
function specificRank(spec: SessionSpec): number {
  if (spec.code === 'BRICK') return 0;
  return specSport(spec) === 'bike' ? 1 : 2;
}

/**
 * «Preparación específica» of a B/C race (`PhaseInfo.specificPrep`): up to
 * `sessions` sessions of the week target that race, its distance setting the
 * race pace. Short race-pace bricks are retargeted; bike and run quality
 * sessions become race-pace sets (BK_RP, RN_RP). Long sessions (and long
 * bricks) keep serving the A race; a running race only takes runs. The chosen
 * sessions become key sessions (priority ≤ 2), so trimming and the Z1-Z2 guard
 * leave them for last.
 */
export function specializeForRace(specs: readonly SessionSpec[], prep: SpecificPrep | null | undefined): SessionSpec[] {
  if (!prep || prep.sessions <= 0) return [...specs];
  const runRace = prep.race.distance.startsWith('run_');
  const candidate = (s: SessionSpec): boolean => {
    if (s.allowedDates || (runRace && specSport(s) !== 'run')) return false;
    if (s.code === 'BRICK') return s.racePace === true && s.longBrick !== true;
    return RACE_PACE_VERSION[s.code] !== undefined;
  };
  const chosen = new Set(
    specs
      .filter(candidate)
      .sort((a, b) => specificRank(a) - specificRank(b) || a.priority - b.priority)
      .slice(0, prep.sessions),
  );
  return specs.map((s) =>
    chosen.has(s)
      ? { ...s, code: RACE_PACE_VERSION[s.code] ?? s.code, priority: Math.min(s.priority, 2), raceDistance: prep.race.distance, specificFor: prep.race.name }
      : s,
  );
}

/**
 * The week-level override (Plan → General) that shapes the week starting on
 * `weekStart`: null without one, when it belongs to another week or when the
 * periodization does not allow changing this week (taper, race, transition…).
 */
export function activeWeekPlan(info: PhaseInfo, plan: WeekPlan | null | undefined, weekStart: ISODate): WeekPlan | null {
  if (!plan || plan.weekStart !== weekStart || !canOverride(info)) return null;
  return plan;
}

const WEEK_PLAN_WORD: Readonly<Record<WeekPlanKind, string>> = { load: 'carga', push: 'más volumen', recovery: 'descarga', rest: 'libre' };

/** "Semana ajustada: descarga." ("Semana ajustada: carga (5h)." with explicit minutes). */
export function weekPlanSentence(plan: Pick<WeekPlan, 'kind' | 'targetMinutes'>): string {
  const minutes = plan.targetMinutes;
  const amount = typeof minutes === 'number' && Number.isFinite(minutes) ? ` (${formatDuration(minutes)})` : '';
  return `Semana ajustada: ${WEEK_PLAN_WORD[plan.kind]}${amount}.`;
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

/** Days of history whose mean daily load seeds fitness and fatigue (same rule as Progreso's cold start). */
const PMC_SEED_WINDOW_DAYS = 28;

function pmcSeed(input: TsbGuardInput): { ctl: number; atl: number } | null {
  const completed = input.history.filter((w) => w.status === 'completed' && w.date < input.range.from);
  if (completed.length > 0) {
    const to = addDays(input.range.from, -1);
    const earliest = completed.reduce((min, w) => (w.date < min ? w.date : min), to);
    const from = earliest > addDays(input.range.from, -60) ? earliest : addDays(input.range.from, -60);
    const loads = dailyLoads(completed, [], { from, to });
    // Seed CTL = ATL = the mean daily load of the first weeks of data. Starting both at 0 (the app
    // reads only 4 weeks) made steady training look like heavy fatigue (TSB around −25) and the
    // guard then dropped half of the week. The shorter the history, the less of that mean is taken
    // as the athlete's norm: one hard week alone still reads as fatigue.
    const seedTo = addDays(from, PMC_SEED_WINDOW_DAYS - 1) < to ? addDays(from, PMC_SEED_WINDOW_DAYS - 1) : to;
    const seedDays = diffDays(seedTo, from) + 1;
    let seedSum = 0;
    for (let d = from; d <= seedTo; d = addDays(d, 1)) seedSum += loads[d] ?? 0;
    const trust = Math.min(1, (diffDays(to, from) + 1) / PMC_SEED_WINDOW_DAYS);
    const seed = seedDays > 0 ? (seedSum / seedDays) * trust : 0;
    const last = computePmc(loads, { from, to }, { ctl: seed, atl: seed }).at(-1);
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
    raceDistance: race.distance,
    sport: isRun ? 'run' : 'brick',
    allowedDates: [race.date],
  };
  // A B/C race done "como un entreno": the race alone, no activation (placement keeps the day before easy).
  if (!isTarget && racePrepOf(race) === 'training') return [raceSpec];
  const dMinus = (n: number) => addDays(race.date, -n);
  const activation: SessionSpec = { code: 'ACTIVATION', durationMin: 25, priority: 2, sport: isRun ? 'run' : 'bike', raceDistance: race.distance, allowedDates: [dMinus(1)] };
  if (!isTarget) return [raceSpec, activation];
  const spark: SessionSpec = isRun
    ? { code: 'RN_THR', durationMin: 40, priority: 2, allowedDates: [dMinus(3), dMinus(4)], note: 'Última sesión con chispa antes de la carrera: corta y sin fatiga.' }
    : { code: 'BRICK', durationMin: 45, brickRunMin: 10, racePace: true, priority: 2, allowedDates: [dMinus(3), dMinus(4)], note: 'Última sesión con chispa antes de la carrera.' };
  const easySwim: SessionSpec[] = isRun ? [] : [{ code: 'SW_TECH', durationMin: 30, priority: 5, allowedDates: [dMinus(2)], note: 'Solo para soltar: nada de cansarse.' }];
  return [raceSpec, activation, spark, ...easySwim];
}

export interface PinnedRaceInput {
  /** The week being planned. */
  info: PhaseInfo;
  /** The week after it (a race early next week pins D−1…D−4 sessions into this one). */
  next: PhaseInfo;
  kind: DistanceKind;
  firstPlannable: ISODate;
  /** Sunday of the week. */
  weekEnd: ISODate;
  /** The race day is already in the calendar: keep only the pre-race sessions. */
  raceDayPlanned?: boolean;
}

/**
 * Race-day and pre-race sessions that fall inside the plannable part of the
 * week: this week's race, plus D−1…D−4 sessions of a race early next week.
 * Pinned sessions whose dates fall outside are left out (not reported as dropped).
 */
export function pinnedRaceSessions(p: PinnedRaceInput): SessionSpec[] {
  const race = p.info.raceInWeek;
  const own = race ? raceWeekSessions(race, p.info.phase === 'race_week', p.kind, p.firstPlannable) : [];
  const ownSpecs = p.raceDayPlanned ? own.filter((s) => s.code !== 'RACE') : own;
  const nextRace = p.next.raceInWeek;
  const early = nextRace && diffDays(nextRace.date, p.weekEnd) <= PRE_RACE_LOOKAHEAD_DAYS ? nextRace : null;
  const earlySpecs = early ? raceWeekSessions(early, p.next.phase === 'race_week', p.kind, p.firstPlannable).filter((s) => s.code !== 'RACE') : [];
  return narrowToWeek([...ownSpecs, ...earlySpecs], p.firstPlannable, p.weekEnd);
}
