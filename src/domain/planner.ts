/**
 * Deterministic weekly planner (rules engine, fully offline).
 * docs/research/02 §13: phase → weekly minutes (hours target × factors, ramp
 * cap) → sport split and sessions → placement with hard rules → 'add' changes.
 * Never deletes or moves the athlete's workouts.
 *
 * With history, the week's running stays within the weekly run cap
 * (runVolume.ts, +15 % over the biggest run week of the last 3): the
 * allocation moves the extra minutes to bike and swim, and the new runs are
 * trimmed when existing runs already fill the week.
 *
 * v4: a week-level override from Plan → General (`weekPlan`: carga, más
 * volumen, descarga, semana libre or explicit minutes) replaces the week's
 * periodization volume and descarga flag; readiness, restrictions, the ramp
 * cap and the freshness guard still apply on top of it.
 */
import { READINESS_EFFECTS, maxHardDays, type DistanceKind } from './constants';
import { allocateWeek } from './allocation';
import { addDays, daysInRange, formatDuration, maxDate, weekdayOf, weekRange } from './dates';
import { distanceKindOf, phaseFor, racePrepOf, type PhaseInfo, type PhaseOptions } from './periodization';
import { placeSessions, type Dropped, type Placed, type PlacementResult } from './placement';
import { dailyLoads, estimateTss } from './load';
import {
  activeWeekPlan,
  capRunSpecs,
  consumeExisting,
  enforceIntensityDistribution,
  historyCaps,
  pinnedRaceSessions,
  rampCapMinutes,
  specRunMinutes,
  specializeForRace,
  trimToBudget,
  tsbGuard,
  weekPlanSentence,
  type HistoryCaps,
} from './plannerSupport';
import { reasonFor, summaryFor } from './plannerText';
import type { Readiness } from './readiness';
import { planRestDays, type RestDayPlan } from './restDays';
import { allowsSession, examVolumeFactor, NO_RESTRICTION, restrictionsForDates, type DayRestriction } from './restrictions';
import { fixedSessionsOn, lowIntensityShareFor, trainingPrefsSentence } from './trainingPrefs';
import { recentRunMinutes, runWeekCapMinutes, workoutRunMinutes } from './runVolume';
import { isAutoAvailability, normalWeekHours, planningAvailability } from './availability';
import { applyWeekPlan, weekMinutesFor } from './season';
import { specClass, specSport, specToDraft, type SessionSpec } from './sessions';
import type {
  BusyBlock,
  FixedWeeklySession,
  ISODate,
  JointSession,
  LifeEvent,
  PlanChange,
  Profile,
  Race,
  RacePrep,
  Sport,
  TrainingPrefs,
  Weekday,
  WeekPlan,
  Workout,
  WorkoutDraft,
} from './types';
import { rangesLength } from './timeRanges';
import { buildWeekModel, type DayState, type FixedInput } from './weekModel';

/** Share of endurance time in Z1-Z2 (kept here for the public API; lives in plannerSupport). */
export { lowIntensityShare } from './plannerSupport';

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
  /**
   * Completed minutes of the 4 weeks before the current week (oldest first):
   * the athlete's volume today, which can turn a short-notice plan into base +
   * build (periodization). Plan → General gets the same; defaults to
   * `recentWeeklyMinutes` (the same weeks when planning the current week).
   */
  fitnessWeeklyMinutes?: number[];
  /** Extension: first date that can still be planned (default weekStart). Pass when planning the current week. */
  today?: ISODate;
  /**
   * Extension: completed workouts of the last ~30 days (Frandsen run cap,
   * long-ride growth, weekly run cap: +15 % over the biggest run week of the last 3).
   */
  history?: Workout[];
  /**
   * Extension: local clock on `today` in minutes since midnight. Time already
   * gone today (plus a 30' buffer) is not offered. Omit when planning a future week.
   */
  nowMinutes?: number;
  /**
   * v4: the week-level override of this week (Plan → General). Changes the
   * volume, the descarga flag, the quality budget and the summary of a
   * prep/base/build week without a race; ignored for other weeks (taper,
   * race, transition…) and when its Monday is not this week's.
   */
  weekPlan?: WeekPlan | null;
  /**
   * Stress (1–5) of today's check-in: ≥ 4 counts as life stress (slower ramp,
   * 2:1 cadence never lifting a descarga), like stress and work events.
   */
  checkinStress?: number | null;
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
  /** Most run minutes of the week (runVolume.ts, bricks count their run leg), null without history. */
  runCapMinutes: number | null;
}

const DEFAULT_LONG_DAYS: Weekday[] = [5, 6];
const STRESS_KINDS: readonly LifeEvent['kind'][] = ['stress', 'work', 'exam'];
/** Check-in stress (1–5) that counts as life stress. */
const CHECKIN_STRESS_MIN = 4;

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

interface Budget {
  targetMinutes: number;
  /** Exam week: the target without the exam cut (summary «… en vez de …»), else null. */
  withoutExamMinutes: number | null;
  budgetMinutes: number;
  allocMinutes: number;
  warnings: string[];
  qualityCut: number;
}

/** Automatic availability: most a normal day / a long-session day can hold, whatever the free time. [H] */
export const AUTO_DAY_MAX_MIN = 150;
export const AUTO_LONG_DAY_MAX_MIN = 330;

/**
 * Training minutes the calendar leaves on the plannable days (automatic
 * availability): free time after busy blocks, timed sessions and the night,
 * capped per day so a free day is not read as 15 hours of training.
 */
export function freeTrainingMinutes(days: readonly DayState[]): number {
  return days
    .filter((d) => d.plannable)
    .reduce((sum, d) => sum + Math.max(0, Math.min(rangesLength(d.free) - d.untimedMin, d.isLongDay ? AUTO_LONG_DAY_MAX_MIN : AUTO_DAY_MAX_MIN)), 0);
}

interface BudgetContext {
  plannable: ISODate[];
  fixed: FixedInput[];
  events: LifeEvent[];
  week: WeekRestrictionSummary;
  lifeStress: boolean;
  /** Hours of a normal week (manual or automatic). */
  weeklyHours: number;
  /** Automatic availability: the week never asks for more than the free time (`freeMinutes`). */
  auto: boolean;
  freeMinutes: number;
  /** The week's override (Plan → General): explicit minutes or a semana libre skip the habitual floor. */
  weekPlan: WeekPlan | null;
  /** Exam week: the factor of the whole week (`examVolumeFactor`), else null. */
  examFactor: number | null;
  /** Mean volume factor of the plannable days from the other events (injury, travel, stress…). */
  dayFactor: number;
}

function computeBudget(input: PlannerInput, info: PhaseInfo, ctx: BudgetContext): Budget {
  const warnings: string[] = [];
  const fraction = ctx.plannable.length / 7;
  const weekMinutes = weekMinutesFor({
    weeklyHours: ctx.weeklyHours,
    info,
    auto: ctx.auto,
    // The habitual volume is the one before the current week (future weeks have no completed minutes yet).
    recentWeeklyMinutes: input.fitnessWeeklyMinutes ?? input.recentWeeklyMinutes,
    plan: ctx.weekPlan,
  });
  // Exams take the whole week down (not only the exam days), so their day factors are left out here.
  let target = weekMinutes * fraction * ctx.dayFactor;
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
  if (ctx.auto && target > ctx.freeMinutes + existingMin) {
    target = ctx.freeMinutes + existingMin;
    warnings.push('Tu calendario va lleno esta semana: he ajustado el volumen a tus huecos libres.');
  }
  const withoutExam = Math.max(0, Math.round(target));
  // A descarga is already lighter than the exam cut: it stays as it is (never higher, never cut twice).
  if (ctx.examFactor !== null && !info.isRecoveryWeek) target *= ctx.examFactor;
  const sportEvents = ctx.events.filter((e) => isSportEvent(e) && ctx.plannable.some((d) => d >= e.startDate && d <= e.endDate));
  const otherMin = sportEvents.reduce((s, e) => s + (e.durationMin ?? 90), 0);
  const hardOthers = sportEvents.filter((e) => e.kind === 'football' || e.kind === 'padel' || e.severity >= 3).length;
  const targetMinutes = Math.max(0, Math.round(target));
  const trainMin = Math.max(0, targetMinutes - otherMin);
  return {
    targetMinutes,
    withoutExamMinutes: ctx.examFactor === null ? null : withoutExam,
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
  /** Phase of the week with the athlete's override (`weekPlan`) applied. */
  info: PhaseInfo;
  /** The override that shaped `info`, null when none applies. */
  weekPlan: WeekPlan | null;
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
  /** Hours of a normal week: the manual target, else the automatic one (level × race distance). */
  weeklyHours: number;
  auto: boolean;
  /** Exams this week: the whole week's volume factor and the exam days; null without exams. */
  exam: { factor: number; days: ISODate[] } | null;
  /** Mean day volume factor of the plannable days without the exams (they cut the whole week instead). */
  dayFactor: number;
  /** «Tu forma de entrenar» (null = everything automático). */
  prefs: TrainingPrefs | null;
  /** Fixed weekly sessions («Tu forma de entrenar») this week adds: already in `fixed`, proposed as new workouts. */
  prefFixed: PrefFixed[];
}

interface PrefFixed {
  id: string;
  date: ISODate;
  session: FixedWeeklySession;
}

/** Periodization options of the planned week: level, life stress and the athlete's recent volume. */
function phaseOptions(input: PlannerInput, lifeStress: boolean): PhaseOptions {
  return { level: input.profile.level, lifeStress, recentWeeklyMinutes: input.fitnessWeeklyMinutes ?? input.recentWeeklyMinutes };
}

/**
 * Life stress moves the recovery cadence to 2:1, which can shift the descarga
 * to another week. Stress never makes a week bigger: when the calm cadence
 * gives this week less (a descarga), that one stays.
 */
function stressedPhase(input: PlannerInput, from: ISODate, lifeStress: boolean): PhaseInfo {
  const stressed = phaseFor(from, input.races, phaseOptions(input, lifeStress));
  if (!lifeStress) return stressed;
  const calm = phaseFor(from, input.races, phaseOptions(input, false));
  const calmIsLighter = (calm.isRecoveryWeek && !stressed.isRecoveryWeek) || calm.volumeFactor < stressed.volumeFactor;
  return calmIsLighter ? calm : stressed;
}

/** Exams overlapping the week: the strongest cut and the exam days inside the week. */
function examOf(events: readonly LifeEvent[], from: ISODate, to: ISODate): { factor: number; days: ISODate[] } | null {
  const exams = events.filter((e) => e.kind === 'exam');
  if (exams.length === 0) return null;
  const days = [...new Set(exams.flatMap((e) => daysInRange({ from: maxDate(e.startDate, from), to: e.endDate < to ? e.endDate : to })))].sort();
  return { factor: Math.min(...exams.map((e) => examVolumeFactor(e.severity))), days };
}

/**
 * Fixed weekly sessions («Tu forma de entrenar») on the plannable days, unless
 * the athlete already has a session of that sport that day, a race is on it or
 * the day's restrictions (injury, illness, travel…) do not allow it.
 */
function fixedPrefSessions(
  prefs: TrainingPrefs | null,
  plannable: readonly ISODate[],
  existing: readonly Workout[],
  restrictions: Record<ISODate, DayRestriction>,
  raceDates: readonly ISODate[],
): PrefFixed[] {
  return fixedSessionsOn(prefs, plannable).flatMap(({ date, session, index }) => {
    if (raceDates.includes(date) || existing.some((w) => w.date === date && w.sport === session.sport)) return [];
    const allowed = allowsSession(restrictions[date] ?? NO_RESTRICTION, { sport: session.sport, intensity: 'endurance', durationMin: session.durationMin, isLong: false, isQuality: false });
    return allowed ? [{ id: `fixed-${index}-${date}`, date, session }] : [];
  });
}

function weekPlanContext(input: PlannerInput): WeekContext {
  const range = weekRange(input.weekStart);
  const dates = daysInRange(range);
  const firstPlannable = maxDate(range.from, input.today ?? range.from);
  const events = input.lifeEvents.filter((e) => overlapsWeek(e, range.from, range.to));
  const stressedByCheckin = typeof input.checkinStress === 'number' && input.checkinStress >= CHECKIN_STRESS_MIN;
  const lifeStress = stressedByCheckin || events.some((e) => STRESS_KINDS.includes(e.kind) && e.severity >= 2);
  const raw = stressedPhase(input, range.from, lifeStress);
  const weekPlan = activeWeekPlan(raw, input.weekPlan, range.from);
  const weeklyHours = normalWeekHours(input.profile.availability, input.profile.level, raw.targetRace?.distance ?? null);
  const info = applyWeekPlan(raw, weekPlan, weeklyHours);
  const target = info.raceInWeek && info.phase === 'race_week' && info.targetRace?.id === info.raceInWeek.id ? info.targetRace : null;
  const plannable = dates.filter((d) => d >= firstPlannable && !(target !== null && d > target.date));
  const restrictions = restrictionsForDates(dates, input.lifeEvents);
  const inWeek = (date: ISODate) => date >= range.from && date <= range.to;
  const active = input.existing.filter((w) => w.status !== 'skipped' && inWeek(w.date));
  const existing = active.filter((w) => w.sport !== 'rest');
  const prefs = input.profile.trainingPrefs ?? null;
  const raceDates = input.races.filter((r) => inWeek(r.date)).map((r) => r.date);
  const prefFixed = fixedPrefSessions(prefs, plannable, existing, restrictions, raceDates);
  const fixed = [
    ...existing.map(workoutFixed),
    ...jointExtras(input.jointSessions, input.existing, input.profile.id).filter((f) => inWeek(f.date)),
    ...prefFixed.map((f): FixedInput => ({ id: f.id, date: f.date, sport: f.session.sport, intensity: 'endurance', durationMin: f.session.durationMin, startTime: f.session.startTime })),
  ];
  const exam = examOf(events, range.from, range.to);
  const week = summarizeRestrictions(plannable, restrictions);
  const dayFactor = exam ? summarizeRestrictions(plannable, restrictionsForDates(dates, input.lifeEvents.filter((e) => e.kind !== 'exam'))).factor : week.factor;
  return {
    exam,
    dayFactor,
    ownRestDates: [...new Set(active.filter((w) => w.sport === 'rest').map((w) => w.date))].sort(),
    raceDates,
    prefs,
    prefFixed,
    range,
    dates,
    firstPlannable,
    events,
    lifeStress,
    info,
    weekPlan,
    plannable,
    restrictions,
    kind: distanceKindOf(info.targetRace?.distance ?? null, input.profile.sports),
    week,
    existing,
    fixed,
    weeklyHours,
    auto: isAutoAvailability(input.profile.availability),
  };
}

/** Race-day and pre-race sessions inside the plannable part of the week (see pinnedRaceSessions). */
function raceSpecsFor(input: PlannerInput, ctx: WeekContext): SessionSpec[] {
  const { info } = ctx;
  return pinnedRaceSessions({
    info,
    next: phaseFor(addDays(ctx.range.from, 7), input.races, phaseOptions(input, ctx.lifeStress)),
    kind: ctx.kind,
    firstPlannable: ctx.firstPlannable,
    weekEnd: ctx.range.to,
    raceDayPlanned: ctx.existing.some((w) => w.date === info.raceInWeek?.date && w.intensity === 'race'),
  });
}

/**
 * Run minutes already in the week: completed runs on any day, planned ones on
 * the plannable days (a missed run does not count). `outside` = on days the
 * planner does not plan (already gone), `inside` = on the plannable days.
 * Bricks count their run leg; accepted quedadas without a linked workout too.
 */
function existingRunMinutes(ctx: WeekContext): { outside: number; inside: number } {
  const plannable = (date: ISODate) => ctx.plannable.includes(date);
  const linked = new Set(ctx.existing.map((w) => w.id));
  const fromWorkouts = ctx.existing.reduce(
    (acc, w) => {
      if (plannable(w.date)) return { ...acc, inside: acc.inside + workoutRunMinutes(w) };
      return w.status === 'completed' ? { ...acc, outside: acc.outside + workoutRunMinutes(w) } : acc;
    },
    { outside: 0, inside: 0 },
  );
  const quedadas = ctx.fixed
    .filter((f) => !linked.has(f.id ?? '') && plannable(f.date))
    .reduce((sum, f) => sum + workoutRunMinutes({ ...f, status: 'planned' }), 0);
  return { outside: fromWorkouts.outside, inside: fromWorkouts.inside + quedadas };
}

interface WeekSpecs {
  specs: SessionSpec[];
  /** The Frandsen long-run cap shortened a run. */
  runCapped: boolean;
  /** The week's run cap (runVolume.ts), null without history. */
  runCap: number | null;
  /** The run cap took minutes out of this week. */
  runCapBinding: boolean;
}

/** Ideal week (allocation) minus what already exists, fitted to the budget and the weekly run cap, plus race-week sessions. */
function buildSpecs(input: PlannerInput, ctx: WeekContext, budget: Budget): WeekSpecs {
  const { info, kind, week } = ctx;
  const caps = historyCaps(input.history ?? [], ctx.range.from, input.profile.thresholds);
  const raceSpecs = raceSpecsFor(input, ctx);
  const specialMin = raceSpecs.filter((s) => s.code !== 'RACE').reduce((s, x) => s + x.durationMin, 0);
  const runCap = runWeekCapMinutes(recentRunMinutes(input.history ?? [], ctx.range.from));
  const pinnedRun = raceSpecs.filter((s) => s.code !== 'RACE').reduce((sum, s) => sum + specRunMinutes(s), 0);
  const ran = existingRunMinutes(ctx);
  const ideal = allocateWeek({
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
    // Existing workouts on the plannable days consume the ideal week: only what is already gone is outside it.
    caps: { runLongMax: caps.runLongMax, bikeLongMax: caps.bikeLongMax, runWeekMax: runCap === null ? null : Math.max(0, runCap - ran.outside - pinnedRun) },
    freeWeek: ctx.weekPlan?.kind === 'rest',
    level: input.profile.level,
    // Exams: maintenance strength instead of heavy lifting.
    lightStrength: ctx.exam !== null,
    prefs: ctx.prefs,
  });
  const existingPlannable = ctx.fixed.filter((f) => ctx.plannable.includes(f.date));
  const remaining = trimToBudget(consumeExisting(ideal.specs, existingPlannable), Math.max(0, budget.budgetMinutes - specialMin));
  // «Preparación específica» of a B/C race: some race-pace sessions target it (before the Z1-Z2 guard, which keeps them for last).
  const specific = specializeForRace(remaining, info.specificPrep);
  const run = runWarnings(caps, enforceIntensityDistribution(specific, info.phase === 'race_week', lowIntensityShareFor(ctx.prefs)));
  // Existing runs that did not match the ideal week can still go over the cap: trim the new runs.
  const weekly = capRunSpecs(run.specs, runCap === null ? null : runCap - ran.outside - ran.inside - pinnedRun);
  return {
    specs: [...raceSpecs, ...weekly.specs],
    runCapped: run.capped,
    runCap,
    runCapBinding: ideal.runCappedMin > 0 || weekly.trimmed > 0,
  };
}

/** "He limitado la carrera a pie a 2h 10' esta semana…" when the weekly run cap took minutes out. */
function runCapWarning(built: WeekSpecs): string[] {
  if (built.runCap === null || !built.runCapBinding) return [];
  return [`He limitado la carrera a pie a ${formatDuration(built.runCap)} esta semana: no conviene subirla más de un 15 % sobre tus últimas semanas.`];
}

interface WeekPlacement {
  placement: PlacementResult;
  rest: RestDayPlan;
}

function raceDatesOf(races: readonly Race[], priority: Race['priority']): ISODate[] {
  return races.filter((r) => r.priority === priority).map((r) => r.date);
}

/** B/C race dates by how they are prepared: mini-taper rules ('taper', 'specific') or "como un entreno" ('training'). */
function minorRaceDates(races: readonly Race[], preps: readonly RacePrep[]): ISODate[] {
  return races.filter((r) => {
    const prep = racePrepOf(r);
    return prep !== null && preps.includes(prep);
  }).map((r) => r.date);
}

/** Long-session days: the days of the long ride and long run chosen in «Tu forma de entrenar», else the availability's. */
function longDaysOf(profile: Profile): Weekday[] {
  const prefs = profile.trainingPrefs;
  const chosen = [...new Set([...(prefs?.longRideDays ?? []), ...(prefs?.longRunDays ?? [])])].sort((a, b) => a - b);
  if (chosen.length > 0) return chosen;
  return profile.availability.longSessionDays.length > 0 ? profile.availability.longSessionDays : DEFAULT_LONG_DAYS;
}

/** Week model before the rest day: free time (windows or the waking day − busy − timed sessions) per day. */
function draftWeekDays(input: PlannerInput, ctx: WeekContext): DayState[] {
  const profile = input.profile;
  const today = input.today && input.today >= ctx.range.from && input.today <= ctx.range.to ? input.today : null;
  return buildWeekModel({
    dates: ctx.dates,
    firstPlannable: ctx.firstPlannable,
    restDay: null,
    longSessionDays: longDaysOf(profile),
    poolDays: profile.availability.poolDays,
    windows: profile.availability.windows,
    busyBlocks: input.busyBlocks,
    fixed: ctx.fixed,
    lifeEvents: ctx.events,
    restrictions: ctx.restrictions,
    today: today ?? undefined,
    nowMinutes: today ? input.nowMinutes : undefined,
  }).map((d) => ({ ...d, plannable: d.plannable && ctx.plannable.includes(d.date) }));
}

/** Dates of the week on the athlete's preferred days («Tu forma de entrenar»). */
function preferredDates(ctx: WeekContext): ISODate[] {
  const prefs = ctx.prefs;
  if (!prefs) return [];
  const days = new Set<number>([...Object.values(prefs.preferredDays).flatMap((d) => d ?? []), ...prefs.longRideDays, ...prefs.longRunDays]);
  return ctx.dates.filter((d) => days.has(weekdayOf(d)));
}

function placeWeek(input: PlannerInput, ctx: WeekContext, budget: Budget, specs: readonly SessionSpec[], draftDays: DayState[]): WeekPlacement {
  const profile = input.profile;
  const longDays = longDaysOf(profile);
  const today = input.today && input.today >= ctx.range.from && input.today <= ctx.range.to ? input.today : null;
  const rest = planRestDays({
    profile,
    days: draftDays,
    hours: budget.targetMinutes / 60,
    longDays,
    ownRestDates: ctx.ownRestDates,
    raceDates: ctx.raceDates,
    // Fixed weekly sessions keep their day: the rest day goes elsewhere.
    pinnedDates: [...new Set([...specs.flatMap((s) => s.allowedDates ?? []), ...ctx.prefFixed.map((f) => f.date)])],
    // Days the athlete prefers for a sport are not the first choice for resting.
    avoidDates: preferredDates(ctx),
  });
  return placeOn(input, ctx, budget, specs, rest, today);
}

function placeOn(input: PlannerInput, ctx: WeekContext, budget: Budget, specs: readonly SessionSpec[], rest: RestDayPlan, today: ISODate | null): WeekPlacement {
  const profile = input.profile;
  const placement = placeSessions(specs, rest.days, {
    kind: ctx.kind,
    maxHardDays: maxHardDays(budget.targetMinutes / 60, profile.level === 'advanced'),
    bigWeekendAllowed: ctx.kind === 'tri_long' && (ctx.info.phase === 'build' || ctx.info.phase === 'peak') && profile.level !== 'beginner',
    aRaceDates: raceDatesOf(input.races, 'A'),
    bRaceDates: minorRaceDates(input.races, ['taper', 'specific']),
    cRaceDates: minorRaceDates(input.races, ['training']),
    readinessToday: today && input.readiness ? { date: today, level: input.readiness.level } : null,
    preferredDays: ctx.prefs?.preferredDays,
    longRideDays: ctx.prefs?.longRideDays,
    longRunDays: ctx.prefs?.longRunDays,
  });
  return { placement, rest };
}

/** Placement may shorten or drop easy sessions: re-check the Z1-Z2 share on what was actually placed (lower hard points only). */
function enforcePlacedDistribution(placed: readonly Placed[], raceWeek: boolean, minShare: number): Placed[] {
  const specs = enforceIntensityDistribution(
    placed.map((p) => p.spec),
    raceWeek,
    minShare,
  );
  return placed.map((p, i) => {
    const spec = specs[i] ?? p.spec;
    return spec === p.spec ? p : { ...p, spec, adjusted: true };
  });
}

/**
 * Phase info for the summary: the override is named before the week's focus
 * and replaces the header's "(descarga)" tag (a semana libre is no descarga).
 */
function summaryInfo(ctx: WeekContext): PhaseInfo {
  const { info, weekPlan } = ctx;
  return weekPlan ? { ...info, isRecoveryWeek: false, focus: `${weekPlanSentence(weekPlan)} ${info.focus}` } : info;
}

const EXAM_NOTE_PREFIX = 'Semana de exámenes';

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** «Semana de exámenes: 4h 10' en vez de 6h, sin series el día antes ni el día del examen.» */
function examSentence(budget: Budget): string | null {
  if (budget.withoutExamMinutes === null) return null;
  const now = round5(budget.targetMinutes);
  const before = round5(budget.withoutExamMinutes);
  const amount = before > now ? `${formatDuration(now)} en vez de ${formatDuration(before)}` : `coincide con la descarga (${formatDuration(now)})`;
  return `${EXAM_NOTE_PREFIX}: ${amount}, sin series el día antes ni el día del examen.`;
}

const FIXED_TITLE: Readonly<Record<FixedWeeklySession['sport'], string>> = { swim: 'Natación', bike: 'Bici', run: 'Carrera', strength: 'Fuerza' };

/** The workout of a fixed weekly session (easy by default: the athlete knows what it holds). */
function fixedSessionDraft(f: PrefFixed): WorkoutDraft {
  const { session } = f;
  return {
    date: f.date,
    startTime: session.startTime,
    sport: session.sport,
    title: session.title || FIXED_TITLE[session.sport],
    description: 'Sesión fija de cada semana (Tú › Tu forma de entrenar).',
    durationMin: session.durationMin,
    distanceM: null,
    intensity: 'endurance',
    tss: estimateTss({ sport: session.sport, durationMin: session.durationMin, intensity: 'endurance' }),
    steps: [],
    isKey: false,
    source: 'rules',
  };
}

/** «Según tu forma de entrenar: …» when the athlete set anything and the week gets sessions. */
function prefsNote(ctx: WeekContext): string[] {
  const sentence = trainingPrefsSentence(ctx.prefs);
  return sentence ? [sentence] : [];
}

function finalize(input: PlannerInput, ctx: WeekContext, budget: Budget, placed: WeekPlacement, built: WeekSpecs): PlanWeekResult {
  const { info } = ctx;
  const { runCapped } = built;
  const guarded = tsbGuard({
    range: ctx.range,
    history: input.history ?? [],
    recentWeeklyMinutes: input.recentWeeklyMinutes,
    fixedLoads: dailyLoads(ctx.existing, ctx.events, ctx.range, { includePlanned: true }),
    placed: placed.placement.placed,
  });
  const guard = { ...guarded, placed: enforcePlacedDistribution(guarded.placed, info.phase === 'race_week', lowIntensityShareFor(ctx.prefs)) };
  const draftCtx = { thresholds: input.profile.thresholds, raceDistance: info.targetRace?.distance ?? null };
  const fixedChanges: PlanChange[] = ctx.prefFixed.map((f) => ({
    op: 'add',
    workout: fixedSessionDraft(f),
    reason: 'Sesión fija de tu forma de entrenar: la planifico cada semana y el resto encaja alrededor.',
  }));
  const changes: PlanChange[] = [
    ...fixedChanges,
    ...guard.placed.map((p): PlanChange => ({
      op: 'add',
      workout: specToDraft(p.spec, p.date, p.startTime, draftCtx),
      reason: reasonFor(p.spec, info, p.adjusted, runCapped && p.spec.code === 'RN_LONG'),
    })),
  ];
  const fatigueNote = guard.removed.length > 0 ? [`He quitado ${guard.removed.length} sesión(es) para no acumular demasiada fatiga.`] : [];
  const examNote = examSentence(budget);
  const warnings = [...info.warnings, ...budget.warnings, ...runCapWarning(built), ...fatigueNote, ...(guard.warning ? [guard.warning] : [])];
  const summary = summaryFor({
    info: summaryInfo(ctx),
    placed: guard.placed,
    dropped: placed.placement.dropped,
    restDay: placed.rest.restDay,
    restMovedForRace: placed.rest.movedForRace,
    easyDay: placed.rest.easyDay,
    existingCount: ctx.existing.filter((w) => ctx.plannable.includes(w.date)).length,
    warnings,
    notes: [
      ...(examNote ? [examNote, ...ctx.week.notes.filter((n) => !n.startsWith(EXAM_NOTE_PREFIX))] : ctx.week.notes),
      ...prefsNote(ctx),
    ],
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
    runCapMinutes: built.runCap,
  };
}

/** Full planner output (used by generateWeek and tests). */
export function planWeek(rawInput: PlannerInput): PlanWeekResult {
  // Automatic availability: no fixed rest day and no windows, the calendar decides.
  const input = { ...rawInput, profile: { ...rawInput.profile, availability: planningAvailability(rawInput.profile.availability) } };
  const ctx = weekPlanContext(input);
  const draftDays = draftWeekDays(input, ctx);
  const budget = computeBudget(input, ctx.info, {
    plannable: ctx.plannable,
    fixed: ctx.fixed,
    events: ctx.events,
    week: ctx.week,
    lifeStress: ctx.lifeStress,
    weeklyHours: ctx.weeklyHours,
    auto: ctx.auto,
    freeMinutes: freeTrainingMinutes(draftDays),
    weekPlan: ctx.weekPlan,
    examFactor: ctx.exam?.factor ?? null,
    dayFactor: ctx.dayFactor,
  });
  const built = buildSpecs(input, ctx, budget);
  return finalize(input, ctx, budget, placeWeek(input, ctx, budget, built.specs, draftDays), built);
}

/** Rules-engine week proposal: only 'add' changes, never touches existing workouts. */
export function generateWeek(input: PlannerInput): { changes: PlanChange[]; summary: string } {
  const result = planWeek(input);
  return { changes: result.changes, summary: result.summary };
}
