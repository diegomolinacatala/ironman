/**
 * The weather layer of the plan (pure, app only): a proposal for an existing
 * week from the forecast, always reviewed by the athlete (never applied here).
 *
 * For each outdoor session (run, bike, brick) that falls in the rain
 * (`weather.ts`), key sessions first:
 * 1. a dry gap the same day (training hours minus busy time, other sessions
 *    and imprevistos; its own time when it is dry there) → new time;
 * 2. 'week' scope only: a dry gap another day of the window that keeps the
 *    rules of the re-planner (rest day, restrictions of injuries and other
 *    sports, no two hard sessions the same day, no hard days in a row, at
 *    most two sessions a day and never two of the same sport) → move;
 * 3. otherwise the indoor version: bike → rodillo, run → piscina or rodillo
 *    with a similar load (`weatherIndoor.ts`).
 * Quedadas are never touched (a sentence asks to agree it with the partner);
 * completed sessions and sessions that already started neither.
 * The signature names what is proposed (sessions and outcome), so the same
 * proposal is not offered twice.
 */
import { addDays, maxDate, minDate, weekdayOf } from './dates';
import { planningAvailability } from './availability';
import { isHardDay } from './hardness';
import { weekdayLabel } from './labels';
import {
  allowedOn,
  dayHard,
  freeTimeOn,
  hardPoints,
  isEditable,
  isJoint,
  makeCtx,
  note,
  partnerName,
  poolOk,
  record,
  sessionCtxOf,
  startPlan,
  type ReplanCtx,
  type ReplanInput,
  type WorkingPlan,
} from './replanCore';
import { largestGap } from './freeTime';
import type { ISODate, PlanChange, Workout } from './types';
import {
  bestGap,
  dryGaps,
  gapAdvice,
  gapNeed,
  isOutdoorSession,
  minToTime,
  sessionWeather,
  startInGap,
  timeToMin,
  whenLabel,
  type MinuteRange,
  type WeatherForecast,
} from './weather';
import { indoorVersion, type IndoorKind } from './weatherIndoor';

export type WeatherScope = 'day' | 'week';

export interface WeatherPlanInput extends ReplanInput {
  forecast: WeatherForecast;
  /** 'day': today only (new time or indoors); 'week': from `today` to `until`, moving across days too. */
  scope: WeatherScope;
  /** Local minutes now: today's sessions that already started are left alone, gaps start after now. */
  nowMinutes?: number;
  /** Last day evaluated (default: today for 'day', today + 6 for 'week'). */
  until?: ISODate;
  /** Sessions already in a pending weather proposal: they are being decided, never proposed twice. */
  exclude?: readonly string[];
}

type Outcome =
  | { kind: 'time'; time: string; gap: MinuteRange }
  | { kind: 'move'; date: ISODate; time: string; gap: MinuteRange }
  | { kind: 'indoor'; to: IndoorKind }
  | { kind: 'none' };

interface Handled {
  workout: Workout;
  rain: MinuteRange;
  outcome: Outcome;
}

export interface WeatherPlanResult {
  changes: PlanChange[];
  summary: string;
  /** What is proposed ("" when nothing): the same proposal is never offered twice. */
  signature: string;
  /** Outdoor sessions in the window that fall in the rain (quedadas included). */
  rainy: number;
}

/** Margin after "now" before a session can start today. */
const START_SOON_MIN = 15;
const MAX_SESSIONS_A_DAY = 2;

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * "hoy", "mañana" or "el jueves". Not `relative` (week proposals, which may wait a day or two
 * for the athlete): always the weekday, so the words stay true.
 */
export function dayWords(date: ISODate, today: ISODate, relative = true): string {
  if (relative && date === today) return 'hoy';
  if (relative && date === addDays(today, 1)) return 'mañana';
  return `el ${weekdayLabel(weekdayOf(date)).toLowerCase()}`;
}

function words(input: WeatherPlanInput, date: ISODate): string {
  return dayWords(date, input.today, input.scope === 'day');
}

/** "a hoy", "a mañana", "al jueves". */
function toDayWords(input: WeatherPlanInput, date: ISODate): string {
  const day = words(input, date);
  return day.startsWith('el ') ? `al ${day.slice(3)}` : `a ${day}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const INDOOR_WORDS: Record<IndoorKind, string> = { trainer: 'rodillo', pool: 'piscina' };

// ---------------------------------------------------------------------------
// Where a rainy session can go
// ---------------------------------------------------------------------------

function freeAfterNow(free: readonly MinuteRange[], date: ISODate, input: WeatherPlanInput): MinuteRange[] {
  if (date !== input.today || input.nowMinutes === undefined) return [...free];
  const from = input.nowMinutes + START_SOON_MIN;
  return free.map((r) => ({ start: Math.max(r.start, from), end: r.end })).filter((r) => r.end > r.start);
}

function dryGapOn(plan: WorkingPlan, ctx: ReplanCtx, input: WeatherPlanInput, w: Workout, date: ISODate): MinuteRange | null {
  const free = freeAfterNow(freeTimeOn(plan, ctx, date, w.id).free, date, input);
  return bestGap(dryGaps(input.forecast.hours, date, { allowed: free, minMinutes: gapNeed(w) }), w);
}

function others(plan: WorkingPlan, date: ISODate, id: string): Workout[] {
  return plan.workouts.filter((x) => x.date === date && x.id !== id && x.status !== 'skipped' && x.sport !== 'rest');
}

/** The re-planner's rules for receiving `w` on `date` (no swaps: nothing else is displaced). */
function dayAccepts(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, date: ISODate): boolean {
  const restDay = ctx.input.profile.availability.restDay;
  if (restDay !== null && weekdayOf(date) === restDay) return false;
  if (!allowedOn(ctx, w, date)) return false;
  const there = others(plan, date, w.id);
  if (there.some((o) => o.status === 'completed' || o.sport === w.sport)) return false;
  if (there.length >= MAX_SESSIONS_A_DAY) return false;
  const points = hardPoints(w);
  if (points > 0 && dayHard(plan, ctx, date, w.id) > 0) return false;
  if (!isHardDay(points)) return true;
  return [addDays(date, -1), addDays(date, 1)].every((d) => !isHardDay(dayHard(plan, ctx, d, w.id)));
}

/** Days to try: closest after the session first, then before it, inside today..until. */
function candidateDates(w: Workout, today: ISODate, until: ISODate): ISODate[] {
  const forward: ISODate[] = [];
  for (let d = maxDate(addDays(w.date, 1), today); d <= until; d = addDays(d, 1)) forward.push(d);
  const backward: ISODate[] = [];
  for (let d = addDays(w.date, -1); d >= today; d = addDays(d, -1)) backward.push(d);
  return [...forward, ...backward];
}

function otherDay(plan: WorkingPlan, ctx: ReplanCtx, input: WeatherPlanInput, w: Workout, until: ISODate): Outcome | null {
  for (const date of candidateDates(w, input.today, until)) {
    if (!dayAccepts(plan, ctx, w, date)) continue;
    const gap = dryGapOn(plan, ctx, input, w, date);
    if (gap) return { kind: 'move', date, time: minToTime(startInGap(gap, w)), gap };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** Free minutes after the session's start (a timed indoor version must not run into the next commitment). */
function roomAfterStart(plan: WorkingPlan, ctx: ReplanCtx, w: Workout): number | null {
  const start = timeToMin(w.startTime);
  if (start === null) return null;
  const range = freeTimeOn(plan, ctx, w.date, w.id).free.find((r) => start >= r.start && start < r.end);
  return range ? range.end - start : null;
}

function poolFits(plan: WorkingPlan, ctx: ReplanCtx, w: Workout): (swimMin: number) => boolean {
  return (swimMin) => {
    if (!ctx.input.profile.sports.includes('swim') || !poolOk(ctx, w.date)) return false;
    if (others(plan, w.date, w.id).some((o) => o.sport === 'swim')) return false;
    const need = swimMin + 30;
    const start = timeToMin(w.startTime);
    const free = freeTimeOn(plan, ctx, w.date, w.id).free;
    if (start === null) return largestGap(free, need) !== null;
    return free.some((r) => start >= r.start && start + need <= r.end);
  };
}

function indoorReason(w: Workout, kind: IndoorKind, why: string): string {
  if (w.sport === 'bike') return `${why}: la misma sesión en rodillo.`;
  if (w.sport === 'brick') return `${why}: el brick pasa a rodillo.`;
  return `${why}: ${INDOOR_WORDS[kind]} con una carga parecida.`;
}

function goIndoors(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, why: string): { plan: WorkingPlan; outcome: Outcome } {
  const version = indoorVersion(w, { why, poolFits: poolFits(plan, ctx, w), maxMin: roomAfterStart(plan, ctx, w), sessionCtx: sessionCtxOf(ctx) });
  if (!version) return { plan, outcome: { kind: 'none' } };
  const reason = indoorReason(w, version.kind, why);
  const next = record(plan, { op: 'update', workoutId: w.id, patch: version.patch, reason });
  return { plan: next, outcome: next.changes.length > plan.changes.length ? { kind: 'indoor', to: version.kind } : { kind: 'none' } };
}

function handle(plan: WorkingPlan, ctx: ReplanCtx, input: WeatherPlanInput, w: Workout, rain: MinuteRange, until: ISODate): { plan: WorkingPlan; outcome: Outcome } {
  const day = words(input, w.date);
  const sameDay = dryGapOn(plan, ctx, input, w, w.date);
  if (sameDay) {
    const time = minToTime(startInGap(sameDay, w));
    const reason = `Lluvia ${day} ${whenLabel(rain)}; ${whenLabel(sameDay)} no llueve.`;
    return { plan: record(plan, { op: 'move', workoutId: w.id, toDate: w.date, toStartTime: time, reason }), outcome: { kind: 'time', time, gap: sameDay } };
  }
  const moved = input.scope === 'week' ? otherDay(plan, ctx, input, w, until) : null;
  if (moved?.kind === 'move') {
    const reason = `Lluvia ${day} ${whenLabel(rain)}; ${words(input, moved.date)} ${whenLabel(moved.gap)} no llueve.`;
    return { plan: record(plan, { op: 'move', workoutId: w.id, toDate: moved.date, toStartTime: moved.time, reason }), outcome: moved };
  }
  return goIndoors(plan, ctx, w, `${capitalize(day)} llueve ${whenLabel(rain)} y no hay un hueco seco`);
}

// ---------------------------------------------------------------------------
// Rainy sessions, summary and signature
// ---------------------------------------------------------------------------

function notStarted(w: Workout, input: WeatherPlanInput): boolean {
  if (w.date !== input.today || input.nowMinutes === undefined) return true;
  const start = timeToMin(w.startTime);
  return start === null ? input.nowMinutes < 21 * 60 : start > input.nowMinutes;
}

function rainyRange(input: WeatherPlanInput, w: Workout): MinuteRange | null {
  const afterMin = w.date === input.today ? input.nowMinutes : undefined;
  const weather = sessionWeather(input.forecast.hours, w, afterMin === undefined ? {} : { afterMin });
  return weather.kind === 'rain' ? weather.rain : null;
}

function byPriority(a: Workout, b: Workout): number {
  if (a.isKey !== b.isKey) return a.isKey ? -1 : 1;
  return a.date.localeCompare(b.date) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.id.localeCompare(b.id);
}

function signatureOf(handled: readonly Handled[]): string {
  const parts = handled
    .map(({ workout: w, outcome: o }) => {
      const target = o.kind === 'time' ? o.time : o.kind === 'move' ? `${o.date} ${o.time}` : o.kind === 'indoor' ? o.to : '';
      return `${w.id}@${w.date} ${w.startTime ?? ''}>${o.kind}:${target}`;
    })
    .sort();
  if (parts.length === 0) return '';
  // FNV-1a: short and stable (it only has to tell proposals apart).
  let hash = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `w1-${hash.toString(16).padStart(8, '0')}`;
}

/** One change, said like a coach: «Sal a correr entre las 16 y las 18: no llueve.» */
function singleSummary(h: Handled, input: WeatherPlanInput): string | null {
  const day = words(input, h.workout.date);
  const o = h.outcome;
  if (o.kind === 'time') {
    const advice = gapAdvice(h.workout.sport, o.gap);
    return day === 'hoy' ? `${advice}.` : `${capitalize(day)}, ${advice.charAt(0).toLowerCase()}${advice.slice(1)}.`;
  }
  if (o.kind === 'move') return `Lluvia ${day}: «${h.workout.title}» pasa ${toDayWords(input, o.date)}, que no llueve.`;
  if (o.kind === 'indoor') return `${capitalize(day)} llueve ${whenLabel(h.rain)}: «${h.workout.title}» pasa a ${INDOOR_WORDS[o.to]}.`;
  return null;
}

function summaryOf(handled: readonly Handled[], input: WeatherPlanInput, changes: number): string {
  const acted = handled.filter((h) => h.outcome.kind !== 'none');
  const [first] = acted;
  if (acted.length === 1 && first) return singleSummary(first, input) ?? '';
  if (changes === 0) return '';
  const what = changes === 1 ? '1 cambio' : `${changes} cambios`;
  if (acted.every((h) => h.outcome.kind === 'indoor')) return `Lluvia sin huecos secos: ${what} para entrenar a cubierto, en rodillo o piscina.`;
  return `Lluvia prevista: ${what} para entrenar en seco.`;
}

/** The weather proposal for the window (empty `changes` when nothing falls in the rain). */
export function planForWeather(rawInput: WeatherPlanInput): WeatherPlanResult {
  // Like the planner: automatic availability has no fixed rest day nor windows (the calendar decides).
  const input = { ...rawInput, profile: { ...rawInput.profile, availability: planningAvailability(rawInput.profile.availability) } };
  const ctx = makeCtx(input);
  const until = minDate(input.until ?? (input.scope === 'day' ? input.today : ctx.weekEnd), ctx.weekEnd);
  let plan = startPlan(input);
  const excluded = new Set(input.exclude ?? []);
  const candidates = plan.workouts
    .filter((w) => isEditable(w, ctx) && w.date <= until && !excluded.has(w.id) && isOutdoorSession(w) && notStarted(w, input))
    .map((w) => ({ w, rain: rainyRange(input, w) }))
    .filter((c): c is { w: Workout; rain: MinuteRange } => c.rain !== null)
    .sort((a, b) => byPriority(a.w, b.w));
  const handled: Handled[] = [];
  for (const { w, rain } of candidates) {
    if (isJoint(w)) {
      plan = note(plan, `Lluvia ${words(input, w.date)} en «${w.title}»: es vuestra quedada con ${partnerName(w, ctx)}, decidid juntos si la movéis.`);
      continue;
    }
    const done = handle(plan, ctx, input, w, rain, until);
    plan = done.plan;
    handled.push({ workout: w, rain, outcome: done.outcome });
  }
  const changes = plan.changes;
  if (candidates.length === 0) return { changes: [], summary: '', signature: '', rainy: 0 };
  const summary = [summaryOf(handled, input, changes.length), ...plan.notes].filter(Boolean).join(' ');
  return { changes, summary, signature: signatureOf(handled), rainy: candidates.length };
}
