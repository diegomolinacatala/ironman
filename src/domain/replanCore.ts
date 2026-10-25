/**
 * Re-planning toolkit: a working copy of the week, protected-session rules
 * (quedadas and key sessions), moves that respect the hard rules, downgrades
 * and substitutions. Completed workouts are never touched.
 */
import { applyPlanChanges } from './changes';
import { SLOT_MARGIN_MIN, START_OFFSET_MIN } from './constants';
import { addDays, daysInRange, minutesToTime, timeToMinutes, weekdayOf } from './dates';
import { isHardDay, lifeEventHardPoints, workoutHardPoints } from './hardness';
import { workoutLoad } from './load';
import { allowsSession, intensityRank, restrictionsForDates, type DayRestriction, NO_RESTRICTION } from './restrictions';
import { buildSession, type SessionCode } from './sessions';
import { busyRangesOn, subtractRanges, windowRangesOn, type MinuteRange } from './timeRanges';
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
}

export interface ReplanResult {
  changes: PlanChange[];
  summary: string;
}

export interface ReplanCtx {
  input: ReplanInput;
  today: ISODate;
  /** Last editable date: today + 6 (rolling 7-day window, may cross into next week). */
  weekEnd: ISODate;
  events: LifeEvent[];
  restrictions: Record<ISODate, DayRestriction>;
}

export interface WorkingPlan {
  workouts: Workout[];
  changes: PlanChange[];
  /** Ids already changed (one change per workout). */
  touched: ReadonlySet<string>;
  notes: string[];
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
  return { input, today: input.today, weekEnd, events, restrictions: restrictionsForDates(dates, events) };
}

/** No pool restriction, or `date` is one of the athlete's pool days. */
export function poolOk(ctx: ReplanCtx, date: ISODate): boolean {
  const pool = ctx.input.profile.availability.poolDays;
  return pool.length === 0 || pool.includes(weekdayOf(date));
}

export function startPlan(input: ReplanInput): WorkingPlan {
  return { workouts: [...input.weekWorkouts], changes: [], touched: new Set<string>(), notes: [] };
}

/** Applies a change to the working copy (same semantics as the server RPC). */
export function record(plan: WorkingPlan, change: PlanChange): WorkingPlan {
  const result = applyPlanChanges(plan.workouts, [change], { userId: APPLY_CTX_USER, now: '1970-01-01T00:00:00', newId: () => `new-${plan.changes.length}` });
  if (result.failed.length > 0) return plan;
  const touched = new Set(plan.touched);
  if (change.op !== 'add') touched.add(change.workoutId);
  return { ...plan, workouts: result.workouts, changes: [...plan.changes, change], touched };
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
  const events = ctx.events
    .filter((e) => e.startDate === date && e.startTime && e.durationMin)
    .map((e) => ({ start: timeToMinutes(e.startTime ?? ''), end: timeToMinutes(e.startTime ?? '') + (e.durationMin ?? 0) }))
    .filter((r) => Number.isFinite(r.start));
  return [...busyRangesOn(date, ctx.input.busyBlocks ?? []), ...timed, ...events];
}

/** Keeps the original time when free, else the first free slot inside the user's windows, else null. */
export function pickStartTime(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, date: ISODate, duration: number): { ok: boolean; time: ISOTime | null } {
  const { ranges, isDefault } = windowRangesOn(date, ctx.input.profile.availability.windows);
  const free = subtractRanges(ranges, occupiedRanges(plan, ctx, date, w.id));
  const margin = SLOT_MARGIN_MIN[w.sport] ?? 0;
  if (w.startTime) {
    const s = timeToMinutes(w.startTime);
    if (free.some((r) => s >= r.start && s + duration <= r.end)) return { ok: true, time: w.startTime };
  }
  const fit = free.find((r) => r.end - r.start >= duration + margin);
  if (isDefault) return { ok: free.reduce((sum, r) => sum + (r.end - r.start), 0) >= duration, time: null };
  if (!fit) return { ok: false, time: null };
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

/** M3: first valid day after the workout (empty days first, then swapping a low-priority session). */
export function findMoveTarget(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, opts: MoveOptions): MoveTarget | null {
  const start = w.date >= ctx.today ? addDays(w.date, 1) : ctx.today;
  const last = addDays(w.date, opts.windowDays) < ctx.weekEnd ? addDays(w.date, opts.windowDays) : ctx.weekEnd;
  const dates: ISODate[] = [];
  for (let d = start; d <= last; d = addDays(d, 1)) if (!(opts.avoid ?? []).includes(d)) dates.push(d);
  const passes: ('empty' | 'swap')[] = !opts.allowSwap ? ['empty'] : opts.preferSwap ? ['swap', 'empty'] : ['empty', 'swap'];
  for (const pass of passes) {
    for (const d of dates) {
      const target = targetOk(plan, ctx, w, d, pass === 'swap');
      if (target && (pass === 'swap') === (target.swap !== null)) return target;
    }
  }
  return null;
}

/** Records a move (plus the deletion of a swapped low-priority session). */
export function moveTo(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, target: MoveTarget, reason: string): WorkingPlan {
  let next = plan;
  if (target.swap) {
    next = record(next, { op: 'delete', workoutId: target.swap.id, reason: `Dejo sitio a «${w.title}»: la sesión suave no hace falta recuperarla.` });
  }
  return record(next, { op: 'move', workoutId: w.id, toDate: target.date, toStartTime: target.time, reason: withPartner(w, ctx, reason) });
}

const EASY_CODE: Partial<Record<Sport, { easy: SessionCode; recovery: SessionCode }>> = {
  run: { easy: 'RN_EASY', recovery: 'RN_REC' },
  bike: { easy: 'BK_END', recovery: 'BK_REC' },
  brick: { easy: 'BK_END', recovery: 'BK_REC' },
  swim: { easy: 'SW_END', recovery: 'SW_TECH' },
  strength: { easy: 'ST_MAINT', recovery: 'MOB' },
  mobility: { easy: 'MOB', recovery: 'MOB' },
};

function roundDuration(n: number): number {
  return Math.max(10, Math.round(n / 5) * 5);
}

/** Patch that turns a session into an easy/recovery one of `sport` (default: same sport). */
export function easyPatch(w: Workout, opts: { durationMin: number; intensity?: Intensity; sport?: Sport; note?: string }): Partial<WorkoutDraft> {
  const sport = opts.sport ?? (w.sport === 'brick' ? 'bike' : w.sport);
  const intensity: Intensity = opts.intensity ?? 'endurance';
  const durationMin = roundDuration(opts.durationMin);
  const codes = EASY_CODE[sport];
  if (!codes) return { sport, intensity, durationMin, tss: estimateTss({ sport, intensity, durationMin }) };
  const code = intensity === 'recovery' ? codes.recovery : codes.easy;
  const content = buildSession({ code, durationMin, priority: 5, note: opts.note ?? null });
  return {
    sport,
    intensity,
    durationMin,
    title: content.title,
    description: content.description,
    steps: content.steps,
    tss: estimateTss({ sport, intensity, durationMin }),
  };
}

export function downgrade(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, opts: { durationMin: number; intensity?: Intensity; sport?: Sport; note?: string }, reason: string): WorkingPlan {
  if (plan.touched.has(w.id)) return plan;
  return record(plan, { op: 'update', workoutId: w.id, patch: easyPatch(w, opts), reason: withPartner(w, ctx, reason) });
}

export function shorten(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, factor: number, reason: string): WorkingPlan {
  if (plan.touched.has(w.id)) return plan;
  const durationMin = roundDuration(w.durationMin * factor);
  if (durationMin >= w.durationMin) return plan;
  return record(plan, { op: 'update', workoutId: w.id, patch: { durationMin, tss: estimateTss({ ...w, durationMin }) }, reason: withPartner(w, ctx, reason) });
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
  return { changes: plan.changes, summary: [headline, body, ...plan.notes].join(' ') };
}
