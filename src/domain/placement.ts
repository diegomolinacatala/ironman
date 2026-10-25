/**
 * Greedy, deterministic week placement (docs/research/02 §10.2-§10.4):
 * sessions sorted by priority are put on the best day that satisfies every
 * hard rule (L01-L12); if none fits they are shortened, downgraded or dropped.
 */
import { LONG_SCALING, MIN_SESSION_MIN, SLOT_MARGIN_MIN, START_OFFSET_MIN, type DistanceKind } from './constants';
import { diffDays, minutesToTime } from './dates';
import type { ReadinessLevel } from './readiness';
import { allowsSession } from './restrictions';
import {
  isQualitySpec,
  specClass,
  specHardPoints,
  specIntensity,
  specSport,
  type SessionCode,
  type SessionSpec,
} from './sessions';
import { subtractRanges, type MinuteRange } from './timeRanges';
import type { ISODate, ISOTime, Sport } from './types';
import type { DayState } from './weekModel';

export interface Placed {
  spec: SessionSpec;
  date: ISODate;
  startTime: ISOTime | null;
  /** Shortened or downgraded to fit. */
  adjusted: boolean;
}

export interface PlacementContext {
  kind: DistanceKind;
  maxHardDays: number;
  /** 70.3 / full distance build or peak with level ≥ intermediate (L02 exception). */
  bigWeekendAllowed: boolean;
  /** A-race dates (heavy strength, D−1 and D−2 safety rules; also across the week boundary). */
  aRaceDates: readonly ISODate[];
  /** B-race dates: mini-taper (no hard days 48 h before, easy D−1) and 2 easy days after (§5.3). */
  bRaceDates?: readonly ISODate[];
  /** C-race dates: easy day before, 1 easy day after (§5.3). */
  cRaceDates?: readonly ISODate[];
  readinessToday: { date: ISODate; level: ReadinessLevel } | null;
}

export interface Dropped {
  spec: SessionSpec;
  reason: string;
}

export interface PlacementResult {
  placed: Placed[];
  dropped: Dropped[];
  bigWeekend: boolean;
}

interface State {
  days: DayState[];
  placed: Placed[][];
  bigWeekendUsed: boolean;
}

const LEG_KEYS: readonly SessionCode[] = ['RN_LONG', 'RN_THR', 'RN_VO2', 'RN_TEMPO', 'RN_HILLS', 'BRICK', 'BK_LONG'];
const BIKE_LONGS: readonly SessionCode[] = ['BK_LONG', 'BRICK'];

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function dayHard(s: State, i: number): number {
  const day = s.days[i];
  if (!day) return 0;
  return day.fixed.reduce((sum, f) => sum + f.hardPoints, 0) + (s.placed[i] ?? []).reduce((sum, p) => sum + specHardPoints(p.spec), 0);
}

function isHard(s: State, i: number): boolean {
  return dayHard(s, i) >= 1;
}

function placedOn(s: State, i: number): Placed[] {
  return s.placed[i] ?? [];
}

function hasRunKey(s: State, i: number): boolean {
  const day = s.days[i];
  if (!day) return false;
  return day.fixed.some((f) => f.runKey) || placedOn(s, i).some((p) => specSport(p.spec) === 'run' && (isQualitySpec(p.spec) || specClass(p.spec) === 'LONG'));
}

function hasLegKey(s: State, i: number): boolean {
  const day = s.days[i];
  if (!day) return false;
  return day.fixed.some((f) => f.legKey) || placedOn(s, i).some((p) => LEG_KEYS.includes(p.spec.code) || (p.spec.code.startsWith('BK_') && isQualitySpec(p.spec)));
}

function hasHeavyStrength(s: State, i: number): boolean {
  const day = s.days[i];
  if (!day) return false;
  return day.fixed.some((f) => f.strengthHeavy) || placedOn(s, i).some((p) => p.spec.code === 'ST_HEAVY');
}

/** A long ride/run or brick already on the day (one long per day). */
function hasLongSession(s: State, i: number): boolean {
  const day = s.days[i];
  if (!day) return false;
  const easy = (f: { intensity: string }) => f.intensity === 'recovery' || f.intensity === 'endurance';
  const fixedLong = day.fixed.some(
    (f) => !f.isOtherSport && (f.sport === 'brick' || (easy(f) && ((f.sport === 'run' && f.durationMin >= 60) || (f.sport === 'bike' && f.durationMin >= 120)))),
  );
  return fixedLong || placedOn(s, i).some((p) => specClass(p.spec) === 'LONG' || specClass(p.spec) === 'BRICK');
}

function sessionCount(s: State, i: number): number {
  return (s.days[i]?.fixed.length ?? 0) + placedOn(s, i).length;
}

function sportsOn(s: State, i: number): Sport[] {
  return [...(s.days[i]?.fixed.map((f) => f.sport) ?? []), ...placedOn(s, i).map((p) => specSport(p.spec))];
}

const BRICK_PARTS: readonly Sport[] = ['bike', 'run'];

/** Same sport twice on a day; a brick already holds a ride and a run. */
function sportClash(a: Sport, b: Sport): boolean {
  if (a === b) return true;
  return (a === 'brick' && BRICK_PARTS.includes(b)) || (b === 'brick' && BRICK_PARTS.includes(a));
}

function dayMinutes(s: State, i: number): number {
  const fixed = s.days[i]?.fixed.reduce((sum, f) => sum + f.durationMin, 0) ?? 0;
  return fixed + placedOn(s, i).reduce((sum, p) => sum + p.spec.durationMin, 0);
}

function hardDays(s: State): number {
  return s.days.reduce((n, _d, i) => n + (isHard(s, i) ? 1 : 0), 0);
}

interface Slot {
  startTime: ISOTime | null;
  range: MinuteRange;
}

function findSlot(day: DayState, spec: SessionSpec, duration: number): Slot | null {
  if (spec.code === 'RACE') return { startTime: null, range: { start: 0, end: 0 } };
  const sport = specSport(spec);
  const margin = SLOT_MARGIN_MIN[sport] ?? 0;
  const need = duration + margin;
  const capacity = day.free.reduce((sum, r) => sum + (r.end - r.start), 0) - day.untimedMin;
  if (capacity < need) return null;
  const range = day.free.find((r) => r.end - r.start >= need);
  if (!range) return null;
  const start = Math.min(range.end - duration, range.start + (START_OFFSET_MIN[sport] ?? 0));
  return { startTime: day.hasUserWindows ? minutesToTime(start) : null, range: { start: range.start, end: range.start + need } };
}

function bigWeekendOk(s: State, ctx: PlacementContext, i: number, spec: SessionSpec): boolean {
  if (!ctx.bigWeekendAllowed || s.bigWeekendUsed) return false;
  const isRunLong = spec.code === 'RN_LONG' && !spec.racePace;
  const isBikeLong = BIKE_LONGS.includes(spec.code);
  if (!isRunLong && !isBikeLong) return false;
  const prevHard = i > 0 && isHard(s, i - 1);
  const nextHard = i < s.days.length - 1 && isHard(s, i + 1);
  if (prevHard === nextHard) return false;
  const j = prevHard ? i - 1 : i + 1;
  const partner = placedOn(s, j);
  const complementary = isRunLong ? partner.some((p) => BIKE_LONGS.includes(p.spec.code)) : partner.some((p) => p.spec.code === 'RN_LONG' && !p.spec.racePace);
  if (!complementary) return false;
  const first = Math.min(i, j);
  const second = Math.max(i, j);
  if (first > 0 && isHard(s, first - 1)) return false;
  if (second < s.days.length - 1 && dayHard(s, second + 1) > 0) return false;
  return true;
}

function readinessAllows(ctx: PlacementContext, day: DayState, spec: SessionSpec, duration: number): boolean {
  const r = ctx.readinessToday;
  if (!r || r.date !== day.date) return true;
  if (r.level === 'red') return specHardPoints(spec) === 0 && duration <= 45 && ['recovery', 'endurance'].includes(specIntensity(spec));
  if (r.level === 'amber') return !isQualitySpec(spec) && specClass(spec) !== 'LONG';
  return true;
}

function isKeyClass(cls: string): boolean {
  return cls === 'QUALITY' || cls === 'LONG' || cls === 'BRICK';
}

/**
 * §5.4 race-week rules for an A race (also across the week boundary): race day
 * alone; no heavy strength in the 7 days before; D−1 rest or the activation;
 * D−2 rest or an easy swim (mobility is fine too).
 */
function aRaceOk(daysBefore: number, spec: SessionSpec, hp: number): boolean {
  if (daysBefore === 0) return false;
  if (spec.code === 'ST_HEAVY' && daysBefore > 0 && daysBefore <= 7) return false;
  if (daysBefore === 1) return spec.code === 'ACTIVATION' || spec.code === 'MOB';
  if (daysBefore === 2) return hp === 0 && (specSport(spec) === 'swim' || specSport(spec) === 'mobility');
  return true;
}

/** Easy days after a B / C race (sprint-olympic B: 2-3 days, C: 1-2 days). [H] §5.3 */
const EASY_DAYS_AFTER: Readonly<Record<'B' | 'C', number>> = { B: 2, C: 1 };

/** §5.3: B = mini-taper (no hard day in the 48 h before, easy D−1); C = easy day before. */
function minorRaceOk(daysBefore: number, priority: 'B' | 'C', spec: SessionSpec, hp: number): boolean {
  const cls = specClass(spec);
  if (daysBefore === 0) return false;
  if (daysBefore === 1 && (isKeyClass(cls) || spec.code === 'ST_HEAVY')) return false;
  if (priority === 'B' && daysBefore === 2 && (hp >= 1 || spec.code === 'ST_HEAVY')) return false;
  if (daysBefore < 0 && -daysBefore <= EASY_DAYS_AFTER[priority] && hp > 0) return false;
  return true;
}

function raceRulesOk(ctx: PlacementContext, day: DayState, spec: SessionSpec, hp: number): boolean {
  if (specClass(spec) === 'RACE') return true;
  if (!ctx.aRaceDates.every((race) => aRaceOk(diffDays(race, day.date), spec, hp))) return false;
  if (!(ctx.bRaceDates ?? []).every((race) => minorRaceOk(diffDays(race, day.date), 'B', spec, hp))) return false;
  return (ctx.cRaceDates ?? []).every((race) => minorRaceOk(diffDays(race, day.date), 'C', spec, hp));
}

/** L03: after a day with ≥ 2 hard points (or two hard days in a row) the next day has 0 points. */
function recoveryRuleOk(s: State, i: number, hp: number, after: number): boolean {
  if (hp <= 0) return true;
  if (i > 0 && dayHard(s, i - 1) >= 2) return false;
  if (i >= 2 && isHard(s, i - 1) && isHard(s, i - 2)) return false;
  return !(after >= 2 && i < s.days.length - 1 && dayHard(s, i + 1) > 0);
}

/** Hard rules L01-L12 for putting `spec` (with `duration`) on day `i`. */
function canPlace(s: State, ctx: PlacementContext, i: number, spec: SessionSpec, duration: number): { ok: boolean; bigWeekend: boolean } {
  const no = { ok: false, bigWeekend: false };
  const day = s.days[i];
  if (!day || !day.plannable) return no;
  if (spec.allowedDates && !spec.allowedDates.includes(day.date)) return no;
  const sport = specSport(spec);
  const cls = specClass(spec);
  const sized = { ...spec, durationMin: duration };
  const hp = specHardPoints(sized);
  const allowed = allowsSession(day.restriction, { sport, intensity: specIntensity(spec), durationMin: duration, isLong: cls === 'LONG', isQuality: cls === 'QUALITY' || cls === 'BRICK' });
  if (!allowed || !readinessAllows(ctx, day, spec, duration) || !raceRulesOk(ctx, day, spec, hp)) return no;
  if (sport === 'swim' && !day.isPoolDay) return no;
  if (placedOn(s, i).some((p) => specClass(p.spec) === 'RACE')) return no;
  if ((cls === 'LONG' || cls === 'BRICK') && hasLongSession(s, i)) return no;
  if (day.dayCapMin !== undefined && day.dayCapMin !== null && dayMinutes(s, i) + duration > day.dayCapMin) return no;
  const count = sessionCount(s, i);
  const light = spec.code === 'ST_MAINT' || spec.code === 'MOB';
  if (count >= 3 || (count >= 2 && !light)) return no;
  const sports = sportsOn(s, i);
  const clash = cls === 'RACE' ? sports.includes(sport) : sports.some((x) => sportClash(sport, x));
  if (sport !== 'strength' && sport !== 'mobility' && clash) return no;
  const current = dayHard(s, i);
  if (hp >= 1 && current >= 1) return no;
  const after = current + hp;
  if (cls !== 'RACE' && !recoveryRuleOk(s, i, hp, after)) return no;
  let bigWeekend = false;
  if (after >= 1) {
    const neighbourHard = (i > 0 && isHard(s, i - 1)) || (i < s.days.length - 1 && isHard(s, i + 1));
    if (neighbourHard) {
      if (!bigWeekendOk(s, ctx, i, spec)) return no;
      bigWeekend = true;
    }
    if (current < 1 && hardDays(s) + 1 > ctx.maxHardDays) return no;
  }
  const isRunKey = sport === 'run' && (cls === 'QUALITY' || cls === 'LONG');
  if (isRunKey && ((i > 0 && hasRunKey(s, i - 1)) || hasRunKey(s, i + 1))) return no;
  if (spec.code === 'ST_HEAVY' && hasLegKey(s, i + 1)) return no;
  if (LEG_KEYS.includes(spec.code) && i > 0 && hasHeavyStrength(s, i - 1)) return no;
  if (!findSlot(day, spec, duration)) return no;
  return { ok: true, bigWeekend };
}

function penalty(s: State, i: number, spec: SessionSpec, duration: number, pendingBikeLong: boolean): number {
  const day = s.days[i];
  if (!day) return Number.POSITIVE_INFINITY;
  const cls = specClass(spec);
  const sport = specSport(spec);
  const capacity = day.free.reduce((sum, r) => sum + (r.end - r.start), 0);
  let p = i * 0.01 + sessionCount(s, i) * 2;
  if (cls === 'LONG' || cls === 'BRICK') p += day.isLongDay ? -capacity / 600 : 8;
  if (spec.code === 'RN_LONG' && pendingBikeLong && day.isLongDay) {
    const maxLongCap = Math.max(...s.days.filter((d) => d.isLongDay && d.plannable).map((d) => d.free.reduce((sum, r) => sum + (r.end - r.start), 0)));
    if (capacity >= maxLongCap) p += 3;
  }
  if (sport === 'run' && i > 0 && isHard(s, i - 1)) p += 4;
  if (sport === 'run' && placedOn(s, i).some((x) => x.spec.code === 'BRICK')) p += 6;
  if (cls === 'QUALITY' && i > 0 && dayHard(s, i - 1) >= 0.5) p += 2;
  for (const j of [i - 1, i + 1]) if (sportsOn(s, j).includes(sport)) p += 1;
  if (spec.code === 'ST_HEAVY' && placedOn(s, i).some((x) => isQualitySpec(x.spec))) p -= 1;
  const slot = findSlot(day, spec, duration);
  if (cls === 'QUALITY' && slot?.startTime && slot.startTime >= '20:00') p += 2;
  return p;
}

function shrinkOptions(spec: SessionSpec): number[] {
  const sport = specSport(spec);
  const min = MIN_SESSION_MIN[sport] ?? 20;
  const d = spec.durationMin;
  const options: number[] = [];
  if (spec.code === 'BK_LONG' && d >= LONG_SCALING.bikeFullMin) options.push(LONG_SCALING.bikeFullMin - 10);
  if (spec.code === 'RN_LONG' && d >= LONG_SCALING.runFullMin) options.push(LONG_SCALING.runFullMin - 5);
  options.push(round5(d * 0.75));
  if (spec.priority <= 3) options.push(round5(d * 0.5));
  return [...new Set(options)].filter((x) => x >= min && x < d && x >= d * 0.5).sort((a, b) => b - a);
}

const DOWNGRADE: Partial<Record<SessionCode, SessionCode>> = {
  BK_TEMPO: 'BK_END',
  BK_SST: 'BK_END',
  BK_THR: 'BK_END',
  BK_VO2: 'BK_END',
  BK_RP: 'BK_END',
  RN_TEMPO: 'RN_EASY',
  RN_THR: 'RN_EASY',
  RN_VO2: 'RN_EASY',
  RN_HILLS: 'RN_EASY',
  RN_LONG: 'RN_EASY',
  BK_LONG: 'BK_END',
  SW_CSS: 'SW_END',
  SW_SPEED: 'SW_END',
  ST_HEAVY: 'ST_MAINT',
};

function downgraded(spec: SessionSpec): SessionSpec | null {
  const code = DOWNGRADE[spec.code];
  if (!code) return null;
  const sport = specSport(spec);
  const cap = sport === 'run' ? 60 : sport === 'bike' ? 120 : code === 'ST_MAINT' ? 30 : 60;
  return { ...spec, code, racePace: false, durationMin: Math.min(spec.durationMin, cap), priority: Math.max(spec.priority, 5) };
}

function bestDay(s: State, ctx: PlacementContext, spec: SessionSpec, duration: number, pendingBikeLong: boolean): { index: number; bigWeekend: boolean } | null {
  let best: { index: number; bigWeekend: boolean; score: number } | null = null;
  for (let i = 0; i < s.days.length; i += 1) {
    const check = canPlace(s, ctx, i, spec, duration);
    if (!check.ok) continue;
    const score = penalty(s, i, spec, duration, pendingBikeLong);
    if (!best || score < best.score) best = { index: i, bigWeekend: check.bigWeekend, score };
  }
  return best ? { index: best.index, bigWeekend: best.bigWeekend } : null;
}

function commit(s: State, index: number, spec: SessionSpec, bigWeekend: boolean, adjusted: boolean): State {
  const day = s.days[index];
  if (!day) return s;
  const slot = findSlot(day, spec, spec.durationMin);
  const free = slot ? subtractRanges(day.free, [slot.range]) : day.free;
  const days = s.days.map((d, i) => (i === index ? { ...d, free } : d));
  const entry: Placed = { spec, date: day.date, startTime: slot?.startTime ?? null, adjusted };
  const placed = s.placed.map((list, i) => (i === index ? [...list, entry] : list));
  return { days, placed, bigWeekendUsed: s.bigWeekendUsed || bigWeekend };
}

function tryPlace(s: State, ctx: PlacementContext, spec: SessionSpec, pendingBikeLong: boolean): State | null {
  const candidates: SessionSpec[] = [spec, ...shrinkOptions(spec).map((d) => ({ ...spec, durationMin: d }))];
  const down = downgraded(spec);
  if (down) candidates.push(down);
  for (const candidate of candidates) {
    const best = bestDay(s, ctx, candidate, candidate.durationMin, pendingBikeLong);
    if (best) return commit(s, best.index, candidate, best.bigWeekend, candidate !== spec);
  }
  return null;
}

function queueOrder(a: SessionSpec, b: SessionSpec): number {
  const fixedA = a.allowedDates ? 0 : 1;
  const fixedB = b.allowedDates ? 0 : 1;
  return a.priority - b.priority || fixedA - fixedB || b.durationMin - a.durationMin || a.code.localeCompare(b.code);
}

/** Places sessions on the week; never touches fixed items. */
export function placeSessions(specs: readonly SessionSpec[], days: readonly DayState[], ctx: PlacementContext): PlacementResult {
  let state: State = { days: days.map((d) => ({ ...d, free: [...d.free] })), placed: days.map(() => []), bigWeekendUsed: false };
  const dropped: Dropped[] = [];
  const queue = [...specs].sort(queueOrder);
  queue.forEach((spec, idx) => {
    const pendingBikeLong = queue.slice(idx + 1).some((x) => BIKE_LONGS.includes(x.code));
    const next = tryPlace(state, ctx, spec, pendingBikeLong);
    if (next) state = next;
    else dropped.push({ spec, reason: 'No hay hueco que cumpla las reglas de descanso y tu disponibilidad.' });
  });
  const placed = state.placed.flat().sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.spec.code.localeCompare(b.spec.code));
  return { placed, dropped, bigWeekend: state.bigWeekendUsed };
}

/** Recomputes the hard-day invariant for tests and validation. */
export function dayHardPoints(days: readonly DayState[], placed: readonly Placed[]): number[] {
  return days.map((d) => d.fixed.reduce((s, f) => s + f.hardPoints, 0) + placed.filter((p) => p.date === d.date).reduce((s, p) => s + specHardPoints(p.spec), 0));
}
