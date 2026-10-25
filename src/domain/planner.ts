/**
 * Deterministic weekly planner (rules engine, fully offline).
 * docs/research/02 §13: phase → weekly minutes (hours target × factors, ramp
 * cap) → sport split and sessions → placement with hard rules → 'add' changes.
 * Never deletes or moves the athlete's workouts.
 */
import { MIN_LOW_INTENSITY_SHARE, PRE_RACE_LOOKAHEAD_DAYS, READINESS_EFFECTS, maxHardDays, type DistanceKind } from './constants';
import { allocateSessions } from './allocation';
import { addDays, daysInRange, diffDays, maxDate, weekRange } from './dates';
import { distanceKindOf, phaseFor, type PhaseInfo } from './periodization';
import { placeSessions, type Dropped, type Placed, type PlacementResult } from './placement';
import { dailyLoads } from './load';
import { consumeExisting, historyCaps, narrowToWeek, raceWeekSessions, rampCapMinutes, trimToBudget, tsbGuard, type HistoryCaps } from './plannerSupport';
import { reasonFor, summaryFor } from './plannerText';
import type { Readiness } from './readiness';
import { planRestDays, type RestDayPlan } from './restDays';
import { NO_RESTRICTION, restrictionsForDates, type DayRestriction } from './restrictions';
import { hardMinutes, isQualitySpec, specClass, specSport, specToDraft, type SessionSpec } from './sessions';
import type { BusyBlock, ISODate, JointSession, LifeEvent, PlanChange, Profile, Race, Sport, Weekday, Workout } from './types';
import { buildWeekModel, type FixedInput } from './weekModel';

export interface PlannerInput {
  weekStart: ISODate;
  profile: Profile;
  races: Race[];
  /** Workouts already in that week (any status). */
  existing: Workout[];
  lifeEvents: LifeEvent[];
  busyBlocks: BusyBlock[];
  jointSessions: JointSession[];
  readiness?: Readiness | null;
  /** Completed minutes of the last 4 weeks (ramp control). */
  recentWeeklyMinutes?: number[];
  /** Extension: first date that can still be planned (default weekStart). Pass when planning the current week. */
  today?: ISODate;
  /** Extension: completed workouts of the last ~30 days (Frandsen run cap, long-ride growth). */
  history?: Workout[];
  /**
   * Extension: local clock on `today` in minutes since midnight. Time already
   * gone today (plus a 30' buffer) is not offered. Omit when planning a future week.
   */
  nowMinutes?: number;
}

export interface PlanWeekResult {
  changes: PlanChange[];
  summary: string;
  phase: PhaseInfo;
  /** Weekly target for the plannable days after every factor (minutes). */
  targetMinutes: number;
  /** Minutes available for new sessions (target − existing − other sports). */
  budgetMinutes: number;
  addedMinutes: number;
  placed: Placed[];
  dropped: Dropped[];
  warnings: string[];
  /** Lowest projected freshness (TSB) of the week, null without history. */
  projectedMinTsb: number | null;
}

const DEFAULT_LONG_DAYS: Weekday[] = [5, 6];
const STRESS_KINDS: readonly LifeEvent['kind'][] = ['stress', 'work', 'exam'];

function overlapsWeek(e: LifeEvent, from: ISODate, to: ISODate): boolean {
  return e.startDate <= to && e.endDate >= from;
}

function isSportEvent(e: LifeEvent): boolean {
  return e.kind === 'padel' || e.kind === 'football' || e.kind === 'other_sport';
}

function workoutFixed(w: Workout): FixedInput {
  const durationMin = w.status === 'completed' ? (w.completed?.durationMin ?? w.durationMin) : w.durationMin;
  return { id: w.id, date: w.date, sport: w.sport, intensity: w.intensity, durationMin, startTime: w.startTime };
}

/** Accepted quedadas without a linked workout in `existing` still occupy the calendar. */
function jointExtras(sessions: readonly JointSession[], existing: readonly Workout[], me: string): FixedInput[] {
  const linked = new Set(existing.map((w) => w.jointSessionId).filter((id): id is string => id !== null));
  return sessions
    .filter((j) => j.status !== 'cancelled' && !linked.has(j.id))
    .filter((j) => j.organizerId === me || j.participants.some((p) => p.userId === me && p.status === 'accepted'))
    .map((j) => ({ id: j.id, date: j.date, sport: j.sport, intensity: j.intensity, durationMin: j.durationMin, startTime: j.startTime }));
}

function onAllDays(dates: readonly ISODate[], restrictions: Record<ISODate, DayRestriction>, pick: (r: DayRestriction) => readonly Sport[]): Sport[] {
  const [first, ...rest] = dates.map((d) => pick(restrictions[d] ?? NO_RESTRICTION));
  if (!first) return [];
  return first.filter((s) => rest.every((list) => list.includes(s)));
}

interface WeekRestrictionSummary {
  factor: number;
  blockedAllWeek: Sport[];
  easyOnlyAllWeek: Sport[];
  substitutes: Partial<Record<Sport, Sport>>;
  qualityCut: number;
  qualityCap: number | null;
  notes: string[];
}

function summarizeRestrictions(dates: readonly ISODate[], restrictions: Record<ISODate, DayRestriction>): WeekRestrictionSummary {
  const list = dates.map((d) => restrictions[d]).filter((r): r is DayRestriction => r !== undefined);
  const factor = list.length === 0 ? 1 : list.reduce((s, r) => s + (r.noTraining ? 0 : r.volumeFactor), 0) / list.length;
  const caps = list.map((r) => r.weekQualityCap).filter((c): c is number => c !== null);
  return {
    factor,
    blockedAllWeek: onAllDays(dates, restrictions, (r) => r.blockedSports),
    easyOnlyAllWeek: onAllDays(dates, restrictions, (r) => r.easyOnlySports),
    substitutes: list.reduce<Partial<Record<Sport, Sport>>>((acc, r) => ({ ...r.substitutes, ...acc }), {}),
    qualityCut: list.reduce((m, r) => Math.max(m, r.qualityCut), 0),
    qualityCap: caps.length > 0 ? Math.min(...caps) : null,
    notes: [...new Set(list.flatMap((r) => r.notes))],
  };
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

/** Keeps Z1-Z2 ≥ 75 % of endurance time (§2.2 invariant) by downgrading the least important quality sessions. */
function enforceIntensityDistribution(specs: readonly SessionSpec[], raceWeek: boolean): SessionSpec[] {
  if (raceWeek) return [...specs];
  let out = [...specs];
  while (lowIntensityShare(out) < MIN_LOW_INTENSITY_SHARE) {
    const quality = out
      .filter((s) => isQualitySpec(s) && specClass(s) !== 'BRICK' && !s.allowedDates && EASY_VERSION[specSport(s)])
      .sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code))[0];
    const code = quality ? EASY_VERSION[specSport(quality)] : undefined;
    if (quality && code) {
      out = out.map((s) => (s === quality ? { ...s, code, priority: Math.max(s.priority, 5) } : s));
      continue;
    }
    // Then race-pace blocks inside long sessions and bricks become plain Z2.
    const paced = out.filter((s) => s.racePace && !s.allowedDates).sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code))[0];
    if (!paced) break;
    out = out.map((s) => (s === paced ? { ...s, racePace: false } : s));
  }
  return out;
}

interface Budget {
  targetMinutes: number;
  budgetMinutes: number;
  allocMinutes: number;
  warnings: string[];
  qualityCut: number;
}

function computeBudget(input: PlannerInput, info: PhaseInfo, ctx: { plannable: ISODate[]; fixed: FixedInput[]; events: LifeEvent[]; week: WeekRestrictionSummary; lifeStress: boolean }): Budget {
  const warnings: string[] = [];
  const fraction = ctx.plannable.length / 7;
  let target = input.profile.availability.weeklyHoursTarget * 60 * info.volumeFactor * fraction * ctx.week.factor;
  const readinessLevel = input.readiness?.level;
  if (readinessLevel === 'red') target *= READINESS_EFFECTS.plannerRedWeekFactor;
  if (readinessLevel === 'amber') target *= READINESS_EFFECTS.plannerAmberWeekFactor;
  const ramp = rampCapMinutes({ recentWeeklyMinutes: input.recentWeeklyMinutes, level: input.profile.level, lifeStress: ctx.lifeStress });
  if (ramp !== null && target > ramp * fraction) {
    target = ramp * fraction;
    warnings.push('He limitado la carga para no subir demasiado rápido respecto a tus últimas semanas.');
  }
  const inPlannable = (date: ISODate) => ctx.plannable.includes(date);
  const existingMin = ctx.fixed.filter((f) => inPlannable(f.date) && f.sport !== 'rest').reduce((s, f) => s + f.durationMin, 0);
  const sportEvents = ctx.events.filter((e) => isSportEvent(e) && ctx.plannable.some((d) => d >= e.startDate && d <= e.endDate));
  const otherMin = sportEvents.reduce((s, e) => s + (e.durationMin ?? 90), 0);
  const hardOthers = sportEvents.filter((e) => e.kind === 'football' || e.kind === 'padel' || e.severity >= 3).length;
  const targetMinutes = Math.max(0, Math.round(target));
  const trainMin = Math.max(0, targetMinutes - otherMin);
  return {
    targetMinutes,
    budgetMinutes: Math.max(0, trainMin - existingMin),
    allocMinutes: trainMin,
    warnings,
    qualityCut: Math.min(2, hardOthers) + ctx.week.qualityCut,
  };
}

function runWarnings(caps: HistoryCaps, specs: readonly SessionSpec[]): { capped: boolean; specs: SessionSpec[] } {
  if (caps.runLongMax === null) return { capped: false, specs: [...specs] };
  const pace = caps.runPaceMinPerKm;
  let capped = false;
  const out = specs.map((s) => {
    if (specSport(s) !== 'run') return s;
    const durationMin = Math.min(s.durationMin, caps.runLongMax ?? s.durationMin);
    if (durationMin < s.durationMin) capped = true;
    const distanceM = pace ? Math.round((durationMin / pace) * 10) * 100 : null;
    return { ...s, durationMin, distanceM };
  });
  return { capped, specs: out };
}

interface WeekContext {
  range: { from: ISODate; to: ISODate };
  dates: ISODate[];
  firstPlannable: ISODate;
  events: LifeEvent[];
  lifeStress: boolean;
  info: PhaseInfo;
  plannable: ISODate[];
  restrictions: Record<ISODate, DayRestriction>;
  kind: DistanceKind;
  week: WeekRestrictionSummary;
  existing: Workout[];
  fixed: FixedInput[];
  /** Dates the athlete already marked as rest ('rest' workouts). */
  ownRestDates: ISODate[];
  /** Race dates inside the week. */
  raceDates: ISODate[];
}

function weekPlanContext(input: PlannerInput): WeekContext {
  const range = weekRange(input.weekStart);
  const dates = daysInRange(range);
  const firstPlannable = maxDate(range.from, input.today ?? range.from);
  const events = input.lifeEvents.filter((e) => overlapsWeek(e, range.from, range.to));
  const lifeStress = events.some((e) => STRESS_KINDS.includes(e.kind) && e.severity >= 2);
  const info = phaseFor(range.from, input.races, { level: input.profile.level, lifeStress });
  const target = info.raceInWeek && info.phase === 'race_week' && info.targetRace?.id === info.raceInWeek.id ? info.targetRace : null;
  const plannable = dates.filter((d) => d >= firstPlannable && !(target !== null && d > target.date));
  const restrictions = restrictionsForDates(dates, input.lifeEvents);
  const inWeek = (date: ISODate) => date >= range.from && date <= range.to;
  const active = input.existing.filter((w) => w.status !== 'skipped' && inWeek(w.date));
  const existing = active.filter((w) => w.sport !== 'rest');
  const fixed = [...existing.map(workoutFixed), ...jointExtras(input.jointSessions, input.existing, input.profile.id).filter((f) => inWeek(f.date))];
  return {
    ownRestDates: [...new Set(active.filter((w) => w.sport === 'rest').map((w) => w.date))].sort(),
    raceDates: input.races.filter((r) => inWeek(r.date)).map((r) => r.date),
    range,
    dates,
    firstPlannable,
    events,
    lifeStress,
    info,
    plannable,
    restrictions,
    kind: distanceKindOf(info.targetRace?.distance ?? null, input.profile.sports),
    week: summarizeRestrictions(plannable, restrictions),
    existing,
    fixed,
  };
}

/**
 * Race-day and pre-race sessions that fall inside the plannable part of the
 * week: this week's race, plus D−1…D−4 sessions of a race early next week.
 * Pinned sessions whose dates fall outside are left out (not reported as dropped).
 */
function raceSpecsFor(input: PlannerInput, ctx: WeekContext): SessionSpec[] {
  const { info, kind } = ctx;
  const own = info.raceInWeek ? raceWeekSessions(info.raceInWeek, info.phase === 'race_week', kind, ctx.firstPlannable) : [];
  const alreadyRace = ctx.existing.some((w) => w.date === info.raceInWeek?.date && w.intensity === 'race');
  const ownSpecs = alreadyRace ? own.filter((s) => s.code !== 'RACE') : own;
  const next = phaseFor(addDays(ctx.range.from, 7), input.races, { level: input.profile.level, lifeStress: ctx.lifeStress });
  const early = next.raceInWeek && diffDays(next.raceInWeek.date, ctx.range.to) <= PRE_RACE_LOOKAHEAD_DAYS ? next.raceInWeek : null;
  const earlySpecs = early ? raceWeekSessions(early, next.phase === 'race_week', kind, ctx.firstPlannable).filter((s) => s.code !== 'RACE') : [];
  return narrowToWeek([...ownSpecs, ...earlySpecs], ctx.firstPlannable, ctx.range.to);
}

/** Ideal week (allocation) minus what already exists, fitted to the budget, plus race-week sessions. */
function buildSpecs(input: PlannerInput, ctx: WeekContext, budget: Budget): { specs: SessionSpec[]; runCapped: boolean } {
  const { info, kind, week } = ctx;
  const caps = historyCaps(input.history ?? [], ctx.range.from, input.profile.thresholds);
  const raceSpecs = raceSpecsFor(input, ctx);
  const specialMin = raceSpecs.filter((s) => s.code !== 'RACE').reduce((s, x) => s + x.durationMin, 0);
  const ideal = allocateSessions({
    phase: info,
    distance: info.targetRace?.distance ?? null,
    kind,
    minutes: Math.max(0, budget.allocMinutes - specialMin),
    sports: input.profile.sports,
    qualityCut: budget.qualityCut,
    qualityCap: week.qualityCap,
    blockedAllWeek: week.blockedAllWeek,
    substitutes: week.substitutes,
    easyOnlyAllWeek: week.easyOnlyAllWeek,
    caps: { runLongMax: caps.runLongMax, bikeLongMax: caps.bikeLongMax },
  });
  const existingPlannable = ctx.fixed.filter((f) => ctx.plannable.includes(f.date));
  const remaining = trimToBudget(consumeExisting(ideal, existingPlannable), Math.max(0, budget.budgetMinutes - specialMin));
  const run = runWarnings(caps, enforceIntensityDistribution(remaining, info.phase === 'race_week'));
  return { specs: [...raceSpecs, ...run.specs], runCapped: run.capped };
}

interface WeekPlacement {
  placement: PlacementResult;
  rest: RestDayPlan;
}

function raceDatesOf(races: readonly Race[], priority: Race['priority']): ISODate[] {
  return races.filter((r) => r.priority === priority).map((r) => r.date);
}

function placeWeek(input: PlannerInput, ctx: WeekContext, budget: Budget, specs: readonly SessionSpec[]): WeekPlacement {
  const profile = input.profile;
  const longDays = profile.availability.longSessionDays.length > 0 ? profile.availability.longSessionDays : DEFAULT_LONG_DAYS;
  const today = input.today && input.today >= ctx.range.from && input.today <= ctx.range.to ? input.today : null;
  const draftDays = buildWeekModel({
    dates: ctx.dates,
    firstPlannable: ctx.firstPlannable,
    restDay: null,
    longSessionDays: longDays,
    poolDays: profile.availability.poolDays,
    windows: profile.availability.windows,
    busyBlocks: input.busyBlocks,
    fixed: ctx.fixed,
    lifeEvents: ctx.events,
    restrictions: ctx.restrictions,
    today: today ?? undefined,
    nowMinutes: today ? input.nowMinutes : undefined,
  }).map((d) => ({ ...d, plannable: d.plannable && ctx.plannable.includes(d.date) }));
  const rest = planRestDays({
    profile,
    days: draftDays,
    hours: budget.targetMinutes / 60,
    longDays,
    ownRestDates: ctx.ownRestDates,
    raceDates: ctx.raceDates,
    pinnedDates: [...new Set(specs.flatMap((s) => s.allowedDates ?? []))],
  });
  const placement = placeSessions(specs, rest.days, {
    kind: ctx.kind,
    maxHardDays: maxHardDays(budget.targetMinutes / 60, profile.level === 'advanced'),
    bigWeekendAllowed: ctx.kind === 'tri_long' && (ctx.info.phase === 'build' || ctx.info.phase === 'peak') && profile.level !== 'beginner',
    aRaceDates: raceDatesOf(input.races, 'A'),
    bRaceDates: raceDatesOf(input.races, 'B'),
    cRaceDates: raceDatesOf(input.races, 'C'),
    readinessToday: today && input.readiness ? { date: today, level: input.readiness.level } : null,
  });
  return { placement, rest };
}

/** Placement may shorten or drop easy sessions: re-check the Z1-Z2 share on what was actually placed (lower hard points only). */
function enforcePlacedDistribution(placed: readonly Placed[], raceWeek: boolean): Placed[] {
  const specs = enforceIntensityDistribution(
    placed.map((p) => p.spec),
    raceWeek,
  );
  return placed.map((p, i) => {
    const spec = specs[i] ?? p.spec;
    return spec === p.spec ? p : { ...p, spec, adjusted: true };
  });
}

function finalize(input: PlannerInput, ctx: WeekContext, budget: Budget, placed: WeekPlacement, runCapped: boolean): PlanWeekResult {
  const { info } = ctx;
  const guarded = tsbGuard({
    range: ctx.range,
    history: input.history ?? [],
    recentWeeklyMinutes: input.recentWeeklyMinutes,
    fixedLoads: dailyLoads(ctx.existing, ctx.events, ctx.range, { includePlanned: true }),
    placed: placed.placement.placed,
  });
  const guard = { ...guarded, placed: enforcePlacedDistribution(guarded.placed, info.phase === 'race_week') };
  const changes: PlanChange[] = guard.placed.map((p) => ({
    op: 'add',
    workout: specToDraft(p.spec, p.date, p.startTime),
    reason: reasonFor(p.spec, info, p.adjusted, runCapped && p.spec.code === 'RN_LONG'),
  }));
  const fatigueNote = guard.removed.length > 0 ? [`He quitado ${guard.removed.length} sesión(es) para no acumular demasiada fatiga.`] : [];
  const warnings = [...info.warnings, ...budget.warnings, ...fatigueNote, ...(guard.warning ? [guard.warning] : [])];
  const summary = summaryFor({
    info,
    placed: guard.placed,
    dropped: placed.placement.dropped,
    restDay: placed.rest.restDay,
    restMovedForRace: placed.rest.movedForRace,
    easyDay: placed.rest.easyDay,
    existingCount: ctx.existing.filter((w) => ctx.plannable.includes(w.date)).length,
    warnings,
    notes: ctx.week.notes,
  });
  return {
    changes,
    summary,
    phase: info,
    targetMinutes: budget.targetMinutes,
    budgetMinutes: budget.budgetMinutes,
    addedMinutes: guard.placed.filter((p) => specClass(p.spec) !== 'RACE').reduce((s, p) => s + p.spec.durationMin, 0),
    placed: guard.placed,
    dropped: [...placed.placement.dropped, ...guard.removed.map((p) => ({ spec: p.spec, reason: 'Demasiada fatiga acumulada para esta semana.' }))],
    warnings,
    projectedMinTsb: guard.minTsb,
  };
}

/** Full planner output (used by generateWeek and tests). */
export function planWeek(input: PlannerInput): PlanWeekResult {
  const ctx = weekPlanContext(input);
  const budget = computeBudget(input, ctx.info, { plannable: ctx.plannable, fixed: ctx.fixed, events: ctx.events, week: ctx.week, lifeStress: ctx.lifeStress });
  const { specs, runCapped } = buildSpecs(input, ctx, budget);
  return finalize(input, ctx, budget, placeWeek(input, ctx, budget, specs), runCapped);
}

/** Rules-engine week proposal: only 'add' changes, never touches existing workouts. */
export function generateWeek(input: PlannerInput): { changes: PlanChange[]; summary: string } {
  const result = planWeek(input);
  return { changes: result.changes, summary: result.summary };
}
