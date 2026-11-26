/**
 * Re-planning toolkit: a working copy of the week, protected-session rules
 * (quedadas and key sessions), moves that respect the hard rules, downgrades
 * and substitutions. Completed workouts are never touched.
 */
import { applyPlanChanges } from './changes';
import { SLOT_MARGIN_MIN, START_OFFSET_MIN } from './constants';
import { addDays, daysInRange, formatDayMedium, maxDate, minDate, minutesToTime, timeToMinutes, weekdayOf } from './dates';
import { eventRangesOn, fitsInFreeTime, largestGap, untimedEventMinutesOn } from './freeTime';
import { isHardDay, lifeEventHardPoints, workoutHardPoints } from './hardness';
import { workoutLoad } from './load';
import { allowsSession, intensityRank, restrictionsForDates, type DayRestriction, NO_RESTRICTION } from './restrictions';
import { easyCodeFor } from './sessionEasier';
import { buildSession, SESSION_CATALOG, type SessionContext } from './sessions';
import { scaleSteps } from './stepScale';
import { busyRangesOn, rangesLength, subtractRanges, windowRangesOn, type MinuteRange } from './timeRanges';
import { estimateTss } from './load';
import type {
  BusyBlock,
  Intensity,
  ISODate,
  ISOTime,
  JointSession,
  LifeEvent,
  PlanChange,
  Profile,
  Race,
  Sport,
  Workout,
  WorkoutDraft,
} from './types';

export interface ReplanInput {
  today: ISODate;
  weekWorkouts: Workout[];
  profile: Profile;
  busyBlocks?: BusyBlock[];
  lifeEvents?: LifeEvent[];
  /** Extension: quedadas of the week (partner names in reasons). */
  jointSessions?: JointSession[];
  /** Extension: races (warnings close to an A race). */
  races?: Race[];
  /** Extension: completed minutes of the 4 weeks before the current week (a short-notice plan's phases, periodization). */
  fitnessWeeklyMinutes?: number[];
}

/** A change the engine prepared but could not apply to its working copy (left out, logged by the caller). */
export interface ReplanFailure {
  change: PlanChange;
  error: string;
}

export interface ReplanResult {
  changes: PlanChange[];
  summary: string;
  /** Changes left out because they did not apply locally (also named in the summary). */
  failures: ReplanFailure[];
}

export interface ReplanCtx {
  input: ReplanInput;
  today: ISODate;
  /** Last editable date: today + 6 (rolling 7-day window, may cross into next week). */
  weekEnd: ISODate;
  events: LifeEvent[];
  restrictions: Record<ISODate, DayRestriction>;
  /** Descarga, semana libre or race week (Plan → General applied): easy sessions are not recovered. */
  easyWeek: boolean;
}

export interface WorkingPlan {
  workouts: Workout[];
  changes: PlanChange[];
  /** Ids already changed (one change per workout). */
  touched: ReadonlySet<string>;
  notes: string[];
  failures: ReplanFailure[];
}

const APPLY_CTX_USER = 'replan';

/**
 * Days the re-planner may edit, counted from `today` (ARCHITECTURE §4: the
 * editable window is today..today+6). It is a rolling window, not the calendar
 * week: on a Sunday it covers the next Monday-Saturday too, so callers should
 * pass the workouts, busy blocks and quedadas of today..today+6. To re-plan a
 * future week, pass today = its Monday.
 */
export const REPLAN_WINDOW_DAYS = 7;

/** Last editable date for a re-plan made on `today`. */
export function replanWindowEnd(today: ISODate): ISODate {
  return addDays(today, REPLAN_WINDOW_DAYS - 1);
}

export function makeCtx(input: ReplanInput, extraEvents: readonly LifeEvent[] = []): ReplanCtx {
  const weekEnd = replanWindowEnd(input.today);
  const base = input.lifeEvents ?? [];
  const events = [...base, ...extraEvents.filter((e) => !base.some((x) => x.id === e.id))];
  const dates = daysInRange({ from: addDays(input.today, -7), to: addDays(weekEnd, 7) });
  return { input, today: input.today, weekEnd, events, restrictions: restrictionsForDates(dates, events), easyWeek: false };
}

/** No pool restriction, or `date` is one of the athlete's pool days. */
export function poolOk(ctx: ReplanCtx, date: ISODate): boolean {
  const pool = ctx.input.profile.availability.poolDays;
  return pool.length === 0 || pool.includes(weekdayOf(date));
}

export function startPlan(input: ReplanInput): WorkingPlan {
  return { workouts: [...input.weekWorkouts], changes: [], touched: new Set<string>(), notes: [], failures: [] };
}

function changeTitle(plan: WorkingPlan, change: PlanChange): string {
  if (change.op === 'add') return change.workout.title;
  return plan.workouts.find((w) => w.id === change.workoutId)?.title ?? 'un entreno';
}

/**
 * Applies a change to the working copy (same semantics as the server RPC).
 * A change that does not apply is left out, kept in `failures` (the caller
 * logs it) and named in the summary so the athlete can fix it by hand.
 */
export function record(plan: WorkingPlan, change: PlanChange): WorkingPlan {
  const result = applyPlanChanges(plan.workouts, [change], { userId: APPLY_CTX_USER, now: '1970-01-01T00:00:00', newId: () => `new-${plan.changes.length}` });
  if (result.failed.length > 0) {
    const error = result.failed[0]?.error ?? 'Cambio no válido';
    const failed = { ...plan, failures: [...plan.failures, { change, error }] };
    return note(failed, `No he podido preparar el cambio de «${changeTitle(plan, change)}» (${error}): revísalo a mano.`);
  }
  const touched = new Set(plan.touched);
  if (change.op !== 'add') touched.add(change.workoutId);
  return { ...plan, workouts: result.workouts, changes: [...plan.changes, change], touched };
}

/** The update already recorded for `workoutId` (shortened, made easy…), if that is its change. */
export function updateFor(plan: WorkingPlan, workoutId: string): Extract<PlanChange, { op: 'update' }> | null {
  const change = plan.changes.find((c) => c.op !== 'add' && c.workoutId === workoutId);
  return change?.op === 'update' ? change : null;
}

/**
 * Extends the update already recorded for a workout (one change per workout):
 * `extra` joins its patch (e.g. a new time or day) and `more` its reason.
 */
export function amendUpdate(plan: WorkingPlan, workoutId: string, extra: Partial<WorkoutDraft>, more: string): WorkingPlan {
  const previous = updateFor(plan, workoutId);
  if (!previous) return plan;
  const result = applyPlanChanges(plan.workouts, [{ op: 'update', workoutId, patch: extra, reason: more }], {
    userId: APPLY_CTX_USER,
    now: '1970-01-01T00:00:00',
    newId: () => `new-${plan.changes.length}`,
  });
  if (result.failed.length > 0) {
    const error = result.failed[0]?.error ?? 'Cambio no válido';
    return note({ ...plan, failures: [...plan.failures, { change: previous, error }] }, `No he podido ajustar la hora de «${changeTitle(plan, previous)}» (${error}): revísalo a mano.`);
  }
  const amended: PlanChange = { ...previous, patch: { ...previous.patch, ...extra }, reason: `${previous.reason.replace(/\.$/, '')}; ${more.replace(/\.$/, '')}.` };
  return { ...plan, workouts: result.workouts, changes: plan.changes.map((c) => (c === previous ? amended : c)) };
}

export function note(plan: WorkingPlan, text: string): WorkingPlan {
  return plan.notes.includes(text) ? plan : { ...plan, notes: [...plan.notes, text] };
}

export function isEditable(w: Workout, ctx: ReplanCtx): boolean {
  return w.status === 'planned' && w.date >= ctx.today && w.date <= ctx.weekEnd && w.sport !== 'rest';
}

export function isJoint(w: Workout): boolean {
  return w.jointSessionId !== null;
}

export function isProtected(w: Workout): boolean {
  return isJoint(w) || w.isKey;
}

export function partnerName(w: Workout, ctx: ReplanCtx): string {
  const session = (ctx.input.jointSessions ?? []).find((j) => j.id === w.jointSessionId);
  const names = (session?.participants ?? []).filter((p) => p.userId !== ctx.input.profile.id).map((p) => p.displayName);
  return names.length > 0 ? names.join(' y ') : 'tu compañero';
}

/** Appends the quedada warning when the workout is shared. Keeps one sentence. */
export function withPartner(w: Workout, ctx: ReplanCtx, reason: string): string {
  const base = reason.replace(/\.$/, '');
  if (!isJoint(w)) return `${base}.`;
  return `${base}; es vuestra quedada, avisa a ${partnerName(w, ctx)} para buscar otra opción.`;
}

export function hardPoints(w: Pick<Workout, 'sport' | 'intensity' | 'durationMin'>): number {
  return workoutHardPoints(w);
}

export function isQualityWorkout(w: Workout): boolean {
  return w.sport === 'brick' || (intensityRank(w.intensity) >= intensityRank('tempo') && w.sport !== 'strength' && w.sport !== 'mobility');
}

export function isLongWorkout(w: Workout): boolean {
  return !isQualityWorkout(w) && hardPoints(w) >= 1;
}

export function isKeyish(w: Workout): boolean {
  return isQualityWorkout(w) || isLongWorkout(w);
}

/** Low-priority session that may be swapped out or dropped first (§9 priority ≥ 5). */
export function isLowPriority(w: Workout): boolean {
  return !isProtected(w) && hardPoints(w) === 0 && intensityRank(w.intensity) <= intensityRank('endurance');
}

function activeOn(plan: WorkingPlan, date: ISODate, exceptId?: string): Workout[] {
  return plan.workouts.filter((w) => w.date === date && w.status !== 'skipped' && w.id !== exceptId && w.sport !== 'rest');
}

export function dayHard(plan: WorkingPlan, ctx: ReplanCtx, date: ISODate, exceptId?: string): number {
  const fromWorkouts = activeOn(plan, date, exceptId).reduce((s, w) => s + hardPoints(w), 0);
  const fromEvents = ctx.events.filter((e) => e.startDate <= date && e.endDate >= date).reduce((s, e) => s + lifeEventHardPoints(e), 0);
  return fromWorkouts + fromEvents;
}

export function dayLoad(plan: WorkingPlan, date: ISODate): number {
  return plan.workouts.filter((w) => w.date === date && w.status !== 'skipped').reduce((s, w) => s + workoutLoad(w), 0);
}

export function restrictionOn(ctx: ReplanCtx, date: ISODate): DayRestriction {
  return ctx.restrictions[date] ?? NO_RESTRICTION;
}

export function allowedOn(ctx: ReplanCtx, w: Pick<Workout, 'sport' | 'intensity' | 'durationMin'>, date: ISODate): boolean {
  const quality = w.sport === 'brick' || intensityRank(w.intensity) >= intensityRank('tempo');
  return allowsSession(restrictionOn(ctx, date), { sport: w.sport, intensity: w.intensity, durationMin: w.durationMin, isLong: !quality && hardPoints(w) >= 1, isQuality: quality });
}

function occupiedRanges(plan: WorkingPlan, ctx: ReplanCtx, date: ISODate, exceptId: string): MinuteRange[] {
  const timed = activeOn(plan, date, exceptId)
    .filter((w) => w.startTime)
    .map((w) => {
      const start = timeToMinutes(w.startTime ?? '');
      return { start, end: start + w.durationMin + (SLOT_MARGIN_MIN[w.sport] ?? 0) };
    })
    .filter((r) => Number.isFinite(r.start));
  // Timed events take their slot every day they last, with a default duration when none was given.
  return [...busyRangesOn(date, ctx.input.busyBlocks ?? []), ...timed, ...eventRangesOn(ctx.events, date)];
}

export interface DayFreeTime {
  /** Training windows (or the default 07:00–22:00 day) minus busy blocks, timed sessions and timed events. */
  free: MinuteRange[];
  /** Minutes already promised without a time: untimed events and the other untimed sessions (with margins). */
  reservedMin: number;
  /** No training windows that weekday: the whole default day. */
  isDefault: boolean;
}

/** Free time of `date` for the session `exceptId` (that session itself is not counted). */
export function freeTimeOn(plan: WorkingPlan, ctx: ReplanCtx, date: ISODate, exceptId: string): DayFreeTime {
  const { ranges, isDefault } = windowRangesOn(date, ctx.input.profile.availability.windows);
  const free = subtractRanges(ranges, occupiedRanges(plan, ctx, date, exceptId));
  const untimedSessions = activeOn(plan, date, exceptId)
    .filter((w) => !w.startTime)
    .reduce((s, w) => s + w.durationMin + (SLOT_MARGIN_MIN[w.sport] ?? 0), 0);
  return { free, reservedMin: untimedEventMinutesOn(ctx.events, date) + untimedSessions, isDefault };
}

/** An untimed session still fits its day: a gap for it (with margin) and enough minutes left. */
export function untimedFits(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, date: ISODate = w.date): boolean {
  const { free, reservedMin } = freeTimeOn(plan, ctx, date, w.id);
  return fitsInFreeTime(free, w.durationMin + (SLOT_MARGIN_MIN[w.sport] ?? 0), reservedMin);
}

export interface PickTimeOptions {
  /** Always return a real time (re-timing the session on the same day), even without training windows. */
  needTime?: boolean;
}

/**
 * Keeps the original time when free; else a time inside the largest free gap
 * (busy blocks, other timed sessions and events removed), even when the day
 * has no training windows. An untimed session moved to a day without windows
 * stays untimed (unless `needTime`) when the day still has room for it.
 */
export function pickStartTime(
  plan: WorkingPlan,
  ctx: ReplanCtx,
  w: Workout,
  date: ISODate,
  duration: number,
  opts: PickTimeOptions = {},
): { ok: boolean; time: ISOTime | null } {
  const { free, reservedMin, isDefault } = freeTimeOn(plan, ctx, date, w.id);
  const margin = SLOT_MARGIN_MIN[w.sport] ?? 0;
  if (w.startTime) {
    const s = timeToMinutes(w.startTime);
    if (free.some((r) => s >= r.start && s + duration <= r.end)) return { ok: true, time: w.startTime };
  }
  if (isDefault && !w.startTime && !opts.needTime) return { ok: fitsInFreeTime(free, duration + margin, reservedMin), time: null };
  const fit = largestGap(free, duration + margin) ?? largestGap(free, duration);
  if (!fit || rangesLength(free) - reservedMin < duration) return { ok: false, time: null };
  return { ok: true, time: minutesToTime(Math.min(fit.end - duration, fit.start + (START_OFFSET_MIN[w.sport] ?? 0))) };
}

export interface MoveOptions {
  windowDays: number;
  /** Dates that cannot receive the session. */
  avoid?: readonly ISODate[];
  allowSwap?: boolean;
  /** Try swapping with an easy session before using an empty day (readiness swaps). */
  preferSwap?: boolean;
}

export interface MoveTarget {
  date: ISODate;
  time: ISOTime | null;
  swap: Workout | null;
}

function neighboursHard(plan: WorkingPlan, ctx: ReplanCtx, date: ISODate, movingId: string, swapId: string | null): boolean {
  return [addDays(date, -1), addDays(date, 1)].some((d) => {
    const pts = activeOn(plan, d, movingId)
      .filter((w) => w.id !== swapId)
      .reduce((s, w) => s + hardPoints(w), 0) + ctx.events.filter((e) => e.startDate <= d && e.endDate >= d).reduce((s, e) => s + lifeEventHardPoints(e), 0);
    return isHardDay(pts);
  });
}

function targetOk(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, date: ISODate, allowSwap: boolean): MoveTarget | null {
  const restDay = ctx.input.profile.availability.restDay;
  if (restDay !== null && weekdayOf(date) === restDay) return null;
  if (!allowedOn(ctx, w, date)) return null;
  if (w.sport === 'swim' && !poolOk(ctx, date)) return null;
  const others = activeOn(plan, date, w.id);
  if (others.some((o) => o.status === 'completed')) return null;
  const swap = others.length === 1 && allowSwap && others[0] && isLowPriority(others[0]) && !plan.touched.has(others[0].id) ? others[0] : null;
  if (others.length > 0 && !swap) return null;
  const eventHard = ctx.events.filter((e) => e.startDate <= date && e.endDate >= date).reduce((s, e) => s + lifeEventHardPoints(e), 0);
  const hp = hardPoints(w);
  if (hp > 0 && eventHard > 0) return null;
  if (isHardDay(hp) && neighboursHard(plan, ctx, date, w.id, swap?.id ?? null)) return null;
  const slot = pickStartTime(swap ? { ...plan, workouts: plan.workouts.filter((x) => x.id !== swap.id) } : plan, ctx, w, date, w.durationMin);
  if (!slot.ok) return null;
  return { date, time: slot.time, swap };
}

/**
 * Candidate days around the workout: forward first (closest first), then
 * backward, never before today nor after the editable window.
 */
function candidateDates(ctx: ReplanCtx, w: Workout, opts: MoveOptions): ISODate[] {
  const avoid = opts.avoid ?? [];
  const forward: ISODate[] = [];
  const last = minDate(addDays(w.date, opts.windowDays), ctx.weekEnd);
  for (let d = w.date >= ctx.today ? addDays(w.date, 1) : ctx.today; d <= last; d = addDays(d, 1)) forward.push(d);
  const backward: ISODate[] = [];
  const first = maxDate(addDays(w.date, -opts.windowDays), ctx.today);
  for (let d = addDays(w.date, -1); d >= first; d = addDays(d, -1)) backward.push(d);
  return [...forward, ...backward].filter((d) => !avoid.includes(d));
}

/** M3: first valid day after the workout, else before it (empty days first, then swapping a low-priority session). */
export function findMoveTarget(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, opts: MoveOptions): MoveTarget | null {
  const dates = candidateDates(ctx, w, opts);
  const passes: ('empty' | 'swap')[] = !opts.allowSwap ? ['empty'] : opts.preferSwap ? ['swap', 'empty'] : ['empty', 'swap'];
  for (const pass of passes) {
    for (const d of dates) {
      const target = targetOk(plan, ctx, w, d, pass === 'swap');
      if (target && (pass === 'swap') === (target.swap !== null)) return target;
    }
  }
  return null;
}

/** Time for an easy session `x` on `date` when that day can take it (window, rest day, restrictions, pool, room). */
function hostOn(plan: WorkingPlan, ctx: ReplanCtx, x: Workout, date: ISODate): { time: ISOTime | null } | null {
  if (date < ctx.today || date > ctx.weekEnd) return null;
  const restDay = ctx.input.profile.availability.restDay;
  if (restDay !== null && weekdayOf(date) === restDay) return null;
  if (!allowedOn(ctx, x, date)) return null;
  if (x.sport === 'swim' && !poolOk(ctx, date)) return null;
  if (activeOn(plan, date, x.id).some((o) => o.status === 'completed')) return null;
  const slot = pickStartTime(plan, ctx, x, date, x.durationMin);
  return slot.ok ? { time: slot.time } : null;
}

/** The easy session displaced by a swap takes the freed day, else another free day; it is dropped only as a last resort. */
function relocateSwapped(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, target: MoveTarget, swap: Workout): WorkingPlan {
  const withoutW = { ...plan, workouts: plan.workouts.filter((x) => x.id !== w.id) };
  const home = hostOn(withoutW, ctx, swap, w.date);
  if (home) {
    const reason = `Intercambio con «${w.title}»: «${swap.title}» pasa al ${formatDayMedium(w.date)}`;
    return record(plan, { op: 'move', workoutId: swap.id, toDate: w.date, toStartTime: home.time, reason: withPartner(swap, ctx, reason) });
  }
  const elsewhere = findMoveTarget(plan, ctx, swap, { windowDays: 3, allowSwap: false, avoid: [target.date, w.date] });
  if (elsewhere) {
    const reason = `Dejo sitio a «${w.title}»: «${swap.title}» pasa al ${formatDayMedium(elsewhere.date)}`;
    return record(plan, { op: 'move', workoutId: swap.id, toDate: elsewhere.date, toStartTime: elsewhere.time, reason: withPartner(swap, ctx, reason) });
  }
  const dropped = record(plan, {
    op: 'delete',
    workoutId: swap.id,
    reason: withPartner(swap, ctx, `Dejo sitio a «${w.title}»: «${swap.title}» no cabe en ningún otro día y, al ser suave, la quito`),
  });
  return note(dropped, `He quitado «${swap.title}» para dejar sitio a «${w.title}»: no cabía en ningún otro día.`);
}

/** Records a move; with a swap, the displaced easy session takes the freed day (a real swap). */
export function moveTo(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, target: MoveTarget, reason: string): WorkingPlan {
  const next = target.swap ? relocateSwapped(plan, ctx, w, target, target.swap) : plan;
  return record(next, { op: 'move', workoutId: w.id, toDate: target.date, toStartTime: target.time, reason: withPartner(w, ctx, reason) });
}

function roundDuration(n: number): number {
  return Math.max(10, Math.round(n / 5) * 5);
}

export interface EasyPatchOptions {
  durationMin: number;
  intensity?: Intensity;
  sport?: Sport;
  note?: string;
}

/**
 * Patch that turns a session into an easy/recovery one of `sport` (default:
 * same sport; easy strength becomes mobility): steady work only (no strides),
 * with coaching and, given
 * `sctx`, the athlete's targets. Sports without an easy session lose their
 * old structure. The planned distance no longer applies.
 */
export function easyPatch(w: Workout, opts: EasyPatchOptions, sctx: SessionContext = {}): Partial<WorkoutDraft> {
  const sport = opts.sport ?? (w.sport === 'brick' ? 'bike' : w.sport);
  const intensity: Intensity = opts.intensity ?? 'endurance';
  const durationMin = roundDuration(opts.durationMin);
  const code = easyCodeFor(sport, intensity === 'recovery' ? 'recovery' : 'endurance');
  if (!code) return { sport, intensity, durationMin, distanceM: null, steps: [], coaching: null, tss: estimateTss({ sport, intensity, durationMin }) };
  // Easy strength is mobility: the easy session's own sport.
  const easySport = SESSION_CATALOG[code].sport;
  const content = buildSession({ code, durationMin, priority: 5, note: opts.note ?? null, plain: true }, sctx);
  return {
    sport: easySport,
    intensity,
    durationMin,
    distanceM: null,
    title: content.title,
    description: content.description,
    steps: content.steps,
    coaching: content.coaching,
    tss: estimateTss({ sport: easySport, intensity, durationMin }),
  };
}

/** The athlete's numbers for rebuilt sessions. */
export function sessionCtxOf(ctx: ReplanCtx): SessionContext {
  return { thresholds: ctx.input.profile.thresholds };
}

export function downgrade(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, opts: EasyPatchOptions, reason: string): WorkingPlan {
  if (plan.touched.has(w.id)) return plan;
  return record(plan, { op: 'update', workoutId: w.id, patch: easyPatch(w, opts, sessionCtxOf(ctx)), reason: withPartner(w, ctx, reason) });
}

/** Patch that shortens a session to `durationMin`, its steps scaled so they never exceed it. */
export function shortenedPatch(w: Workout, durationMin: number): Partial<WorkoutDraft> {
  const steps = w.steps.length > 0 ? { steps: scaleSteps(w.steps, w.durationMin, durationMin) } : {};
  return { durationMin, tss: estimateTss({ ...w, durationMin }), ...steps };
}

export function shorten(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, factor: number, reason: string): WorkingPlan {
  if (plan.touched.has(w.id)) return plan;
  const durationMin = roundDuration(w.durationMin * factor);
  if (durationMin >= w.durationMin) return plan;
  return record(plan, { op: 'update', workoutId: w.id, patch: shortenedPatch(w, durationMin), reason: withPartner(w, ctx, reason) });
}

export function remove(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, reason: string): WorkingPlan {
  if (plan.touched.has(w.id)) return plan;
  return record(plan, { op: 'delete', workoutId: w.id, reason: withPartner(w, ctx, reason) });
}

export function current(plan: WorkingPlan, id: string): Workout | undefined {
  return plan.workouts.find((w) => w.id === id);
}

/** Pending editable workouts in date order (stable). */
export function pending(plan: WorkingPlan, ctx: ReplanCtx, filter: (w: Workout) => boolean = () => true): Workout[] {
  return plan.workouts
    .filter((w) => isEditable(w, ctx) && !plan.touched.has(w.id) && filter(w))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));
}

export function finish(plan: WorkingPlan, headline: string, nothing: string): ReplanResult {
  const count = plan.changes.length;
  const body = count === 0 ? nothing : `${count === 1 ? 'Propongo 1 cambio' : `Propongo ${count} cambios`} para los próximos días.`;
  return { changes: plan.changes, summary: [headline, body, ...plan.notes].join(' '), failures: plan.failures };
}
