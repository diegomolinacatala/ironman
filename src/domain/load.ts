/**
 * Training load (TSS-like "Carga"), performance management chart
 * (Forma física / Fatiga / Frescura) and compliance.
 * Backed by docs/research/02 §3-§4 and research 01 §4.4.3.
 */
import {
  ATL_TAU,
  BIKE_SESSION_IF,
  BRICK_BIKE_SHARE,
  COMPLIANCE_BANDS,
  CTL_TAU,
  FIXED_TSS_PER_HOUR,
  OTHER_SPORT_PROFILES,
  RPE_TO_IF,
  RUN_SESSION_IF,
  SWIM_SESSION_IF,
} from './constants';
import { daysInRange, isDateInRange, weekRange } from './dates';
import type { DateRange, Intensity, ISODate, LifeEvent, Sport, Workout } from './types';

/** Reference whole-session IF by intensity (bike/power convention). */
export const INTENSITY_IF: Record<Intensity, number> = { ...BIKE_SESSION_IF };

export interface LoadEstimateInput {
  sport: Sport;
  durationMin: number;
  intensity: Intensity;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hours(min: number): number {
  return Number.isFinite(min) && min > 0 ? min / 60 : 0;
}

/** Planned load estimate: IF² for bike/run (IF³ for swim), fixed table for strength/mobility. */
export function estimateTss(w: LoadEstimateInput): number {
  const h = hours(w.durationMin);
  if (h === 0) return 0;
  switch (w.sport) {
    case 'swim':
      return round1(h * SWIM_SESSION_IF[w.intensity] ** 3 * 100);
    case 'run':
      return round1(h * RUN_SESSION_IF[w.intensity] ** 2 * 100);
    case 'bike':
    case 'other':
      return round1(h * BIKE_SESSION_IF[w.intensity] ** 2 * 100);
    case 'brick': {
      const bike = BIKE_SESSION_IF[w.intensity] ** 2 * BRICK_BIKE_SHARE;
      const run = RUN_SESSION_IF[w.intensity] ** 2 * (1 - BRICK_BIKE_SHARE);
      return round1(h * (bike + run) * 100);
    }
    default:
      return round1(h * (FIXED_TSS_PER_HOUR[w.sport] ?? 0));
  }
}

/** sRPE load: h × IF(rpe)² × 100. */
export function rpeLoad(durationMin: number, rpe: number): number {
  const key = Math.min(Math.max(Math.round(rpe), 1), 10);
  const intensityFactor = RPE_TO_IF[key] ?? RPE_TO_IF[5] ?? 0.76;
  return round1(hours(durationMin) * intensityFactor ** 2 * 100);
}

/** A row inserted already completed: created within this window of its completion time. [H] */
const CREATED_COMPLETED_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * Logged by Claude (MCP log_completed_activity) without a planned session:
 * such rows are inserted already completed (createdAt ≈ completed.completedAt).
 * A planned Claude session completed later keeps an older createdAt.
 */
function isClaudeLoggedActivity(w: Workout): boolean {
  if (w.source !== 'claude') return false;
  const created = Date.parse(w.createdAt);
  const completed = Date.parse(w.completed?.completedAt ?? '');
  return Number.isFinite(created) && Number.isFinite(completed) && Math.abs(completed - created) <= CREATED_COMPLETED_TOLERANCE_MS;
}

/** Whether the workout was imported/logged without a matching planned session. */
export function isUnplanned(w: Workout): boolean {
  if (w.status !== 'completed') return false;
  return w.externalId !== null || w.source === 'garmin' || w.source === 'healthkit' || isClaudeLoggedActivity(w);
}

function completedDuration(w: Workout): number {
  const d = w.completed?.durationMin;
  return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : w.durationMin;
}

/** Completed tss → sRPE → planned estimate; 0 for skipped workouts and rest days. */
export function workoutLoad(w: Workout): number {
  if (w.status === 'skipped' || w.sport === 'rest') return 0;
  if (w.status === 'completed') {
    const tss = w.completed?.tss;
    if (typeof tss === 'number' && Number.isFinite(tss) && tss >= 0) return round1(tss);
    const duration = completedDuration(w);
    const rpe = w.completed?.rpe;
    const usesTable = w.sport === 'strength' || w.sport === 'mobility';
    if (!usesTable && typeof rpe === 'number' && rpe >= 1) return rpeLoad(duration, rpe);
    return estimateTss({ sport: w.sport, durationMin: duration, intensity: w.intensity });
  }
  if (typeof w.tss === 'number' && Number.isFinite(w.tss) && w.tss >= 0) return round1(w.tss);
  return estimateTss(w);
}

/** sRPE-style load of other sports (pádel, fútbol…) per day of the event; 0 for non-sport events. */
export function lifeEventLoad(e: LifeEvent): number {
  if (e.kind !== 'padel' && e.kind !== 'football' && e.kind !== 'other_sport') return 0;
  const profile = OTHER_SPORT_PROFILES[e.kind];
  const duration = e.durationMin ?? profile.defaultDurationMin;
  const intensityFactor = profile.ifBySeverity[Math.min(Math.max(e.severity, 1), 3) - 1] ?? profile.ifBySeverity[1];
  return round1(hours(duration) * intensityFactor ** 2 * 100);
}

export interface DailyLoadOptions {
  /** Include planned (not yet done) workouts, e.g. for projections. Default false. */
  includePlanned?: boolean;
  /** With includePlanned: only count planned workouts on/after this date. */
  plannedFrom?: ISODate;
}

/** Sum of load per day of the range (every date present, 0 when nothing). */
export function dailyLoads(
  workouts: readonly Workout[],
  events: readonly LifeEvent[],
  range: DateRange,
  opts: DailyLoadOptions = {},
): Record<ISODate, number> {
  const result: Record<ISODate, number> = {};
  for (const date of daysInRange(range)) result[date] = 0;
  for (const w of workouts) {
    if (!(w.date in result)) continue;
    const counts =
      w.status === 'completed' ||
      (w.status === 'planned' && opts.includePlanned === true && (!opts.plannedFrom || w.date >= opts.plannedFrom));
    if (counts) result[w.date] = round1((result[w.date] ?? 0) + workoutLoad(w));
  }
  for (const e of events) {
    const load = lifeEventLoad(e);
    if (load === 0) continue;
    for (const date of daysInRange({ from: e.startDate, to: e.endDate })) {
      if (date in result) result[date] = round1((result[date] ?? 0) + load);
    }
  }
  return result;
}

export interface PmcPoint {
  date: ISODate;
  load: number;
  /** Fitness ("Forma física"), 42-day EWMA. */
  ctl: number;
  /** Fatigue ("Fatiga"), 7-day EWMA. */
  atl: number;
  /** Form ("Frescura") = CTL(yesterday) − ATL(yesterday). */
  tsb: number;
}

const K_CTL = 1 - Math.exp(-1 / CTL_TAU);
const K_ATL = 1 - Math.exp(-1 / ATL_TAU);

/** Performance management chart over the range. Missing days count as 0 load. */
export function computePmc(
  loads: Readonly<Record<ISODate, number>>,
  range: DateRange,
  seed: { ctl: number; atl: number } = { ctl: 0, atl: 0 },
): PmcPoint[] {
  let ctl = Number.isFinite(seed.ctl) ? seed.ctl : 0;
  let atl = Number.isFinite(seed.atl) ? seed.atl : 0;
  return daysInRange(range).map((date) => {
    const raw = loads[date];
    const load = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
    const tsb = ctl - atl;
    ctl += (load - ctl) * K_CTL;
    atl += (load - atl) * K_ATL;
    return { date, load: round1(load), ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb) };
  });
}

/** Weekly load that raises CTL by `ramp` points in 7 days from `ctl` (§4.1). */
export function weeklyLoadForRamp(ctl: number, ramp: number): number {
  return round1(7 * (ctl + ramp / (1 - Math.exp(-7 / CTL_TAU))));
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export type Compliance = 'done' | 'partial' | 'off' | 'missed' | 'unplanned' | 'adjusted' | 'pending';

function band(ratio: number): Compliance {
  const pct = Math.round(ratio * 100);
  if (pct >= COMPLIANCE_BANDS.doneMin && pct <= COMPLIANCE_BANDS.doneMax) return 'done';
  if (pct >= COMPLIANCE_BANDS.partialMin && pct <= COMPLIANCE_BANDS.partialMax) return 'partial';
  return 'off';
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** TrainingPeaks bands on load → duration → distance. Skipped = 'adjusted' (conscious decision). */
export function complianceOf(w: Workout, today: ISODate): Compliance {
  if (w.sport === 'rest') return w.date < today ? 'done' : 'pending';
  if (w.status === 'skipped') return 'adjusted';
  if (w.status === 'planned') return w.date < today ? 'missed' : 'pending';
  if (isUnplanned(w)) return 'unplanned';
  const doneTss = w.completed?.tss;
  const doneMin = w.completed?.durationMin;
  const doneDistance = w.completed?.distanceM;
  if (positive(w.tss) && positive(doneTss)) return band(doneTss / w.tss);
  if (positive(w.durationMin) && positive(doneMin)) return band(doneMin / w.durationMin);
  if (positive(w.distanceM) && positive(doneDistance)) return band(doneDistance / w.distanceM);
  return 'done';
}

// ---------------------------------------------------------------------------
// Week summary
// ---------------------------------------------------------------------------

export interface SportTotals {
  plannedMin: number;
  completedMin: number;
  count: number;
}

export interface WeekSummary {
  plannedMin: number;
  completedMin: number;
  plannedTss: number;
  completedTss: number;
  /** Planned sessions (excludes rest days and unplanned imports). */
  sessions: number;
  completedSessions: number;
  /** Duration-weighted completion of sessions due so far (0..1), null when nothing is due. */
  compliancePct: number | null;
  bySport: Partial<Record<Sport, SportTotals>>;
}

function addSport(
  bySport: Partial<Record<Sport, SportTotals>>,
  sport: Sport,
  delta: SportTotals,
): Partial<Record<Sport, SportTotals>> {
  const prev = bySport[sport] ?? { plannedMin: 0, completedMin: 0, count: 0 };
  return {
    ...bySport,
    [sport]: {
      plannedMin: prev.plannedMin + delta.plannedMin,
      completedMin: prev.completedMin + delta.completedMin,
      count: prev.count + delta.count,
    },
  };
}

export function weekSummary(workouts: readonly Workout[], weekStart: ISODate, today: ISODate): WeekSummary {
  const range = weekRange(weekStart);
  const week = workouts.filter((w) => isDateInRange(w.date, range) && w.sport !== 'rest');
  let summary: WeekSummary = {
    plannedMin: 0,
    completedMin: 0,
    plannedTss: 0,
    completedTss: 0,
    sessions: 0,
    completedSessions: 0,
    compliancePct: null,
    bySport: {},
  };
  let dueMin = 0;
  let creditMin = 0;
  for (const w of week) {
    const unplanned = isUnplanned(w);
    const isDone = w.status === 'completed';
    const plannedMin = unplanned ? 0 : w.durationMin;
    const doneMin = isDone ? completedDuration(w) : 0;
    summary = {
      ...summary,
      plannedMin: summary.plannedMin + plannedMin,
      completedMin: summary.completedMin + doneMin,
      plannedTss: round1(summary.plannedTss + (unplanned ? 0 : (w.tss ?? estimateTss(w)))),
      completedTss: round1(summary.completedTss + (isDone ? workoutLoad(w) : 0)),
      sessions: summary.sessions + (unplanned ? 0 : 1),
      completedSessions: summary.completedSessions + (!unplanned && isDone ? 1 : 0),
      bySport: addSport(summary.bySport, w.sport, { plannedMin, completedMin: doneMin, count: 1 }),
    };
    const isDue = !unplanned && w.status !== 'skipped' && (isDone || w.date < today);
    if (isDue && w.durationMin > 0) {
      dueMin += w.durationMin;
      creditMin += Math.min(doneMin, w.durationMin);
    }
  }
  return { ...summary, compliancePct: dueMin > 0 ? Math.round((creditMin / dueMin) * 100) / 100 : null };
}
