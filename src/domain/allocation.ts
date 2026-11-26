/**
 * Weekly session allocation (docs/research/02 §7-§9): weekly minutes → sport
 * split by phase → sessions per sport by hours → session types (long,
 * quality, brick, fillers) with durations. Placement happens in placement.ts.
 */
import {
  LONG_CAPS,
  LONG_SHARE,
  MIN_SESSION_MIN,
  QUALITY_BUDGET,
  RUN_SESSIONS_BY_HOURS,
  SESSIONS_BY_HOURS,
  SPLIT_BASE_LONG,
  SPLIT_BASE_SHORT,
  SPLIT_BUILD_FULL,
  SPLIT_BUILD_HALF,
  SPLIT_BUILD_SHORT,
  SPLIT_PEAK,
  SPLIT_PREP,
  SPLIT_RUN,
  SUBSTITUTION_RATIO,
  type DistanceKind,
  type SportSplit,
} from './constants';
import type { PhaseInfo } from './periodization';
import type { SessionCode, SessionSpec } from './sessions';
import type { AthleteLevel, IntensityModel, RaceDistance, Sport, TrainableSport, TrainingPrefs } from './types';

export interface AllocationCaps {
  /** Max run-long minutes (Frandsen-derived), null = no data. */
  runLongMax: number | null;
  /** Max bike-long minutes (+15 % rule), null = no data. */
  bikeLongMax: number | null;
  /**
   * Most run minutes this allocation may hold, the run legs of bricks included
   * (the weekly run cap of runVolume.ts minus the running already done or
   * pinned this week); null or absent = no cap. Triathletes get the minutes
   * over it on the bike and in the pool; run-only plans just get a shorter week.
   */
  runWeekMax?: number | null;
}

export interface AllocationResult {
  specs: SessionSpec[];
  /** Run minutes the weekly run cap took out of the week (0 = the cap did not bind). */
  runCappedMin: number;
}

export interface AllocationInput {
  phase: PhaseInfo;
  distance: RaceDistance | null;
  kind: DistanceKind;
  /** Training minutes to allocate this week. */
  minutes: number;
  sports: readonly TrainableSport[];
  /** QUALITY sessions to remove (other hard sports, stress…). */
  qualityCut: number;
  /** Max QUALITY sessions (exam/work weeks), null = phase budget. */
  qualityCap: number | null;
  /** Sports blocked the whole week (injury) and their substitutes. */
  blockedAllWeek: readonly Sport[];
  substitutes: Partial<Record<Sport, Sport>>;
  /** Sports allowed only easy the whole week. */
  easyOnlyAllWeek: readonly Sport[];
  caps: AllocationCaps;
  /**
   * "Semana libre" (WeekPlan 'rest': holidays, exams, travel): easy sessions
   * only, no quality and no long sessions, like a transition week.
   */
  freeWeek?: boolean;
  /** Beginners: at most one quality session in base (two in build), maintenance strength only. */
  level?: AthleteLevel;
  /** Maintenance strength instead of heavy lifting (exam weeks). */
  lightStrength?: boolean;
  /**
   * «Tu forma de entrenar»: sessions per sport (within the week's minutes and
   * never below the minimum session length) and the intensity model.
   */
  prefs?: TrainingPrefs | null;
}

type Endurance = 'swim' | 'bike' | 'run';

function round5(n: number): number {
  return Math.max(0, Math.round(n / 5) * 5);
}

function splitFor(info: PhaseInfo, kind: DistanceKind, distance: RaceDistance | null): SportSplit {
  if (kind === 'run') return SPLIT_RUN;
  switch (info.phase) {
    case 'prep':
    case 'transition':
    case 'recovery':
      return SPLIT_PREP;
    case 'base':
      return kind === 'tri_long' ? SPLIT_BASE_LONG : SPLIT_BASE_SHORT;
    case 'build':
      if (kind === 'tri_short') return SPLIT_BUILD_SHORT;
      return distance === 'full' ? SPLIT_BUILD_FULL : SPLIT_BUILD_HALF;
    default:
      return SPLIT_PEAK;
  }
}

function countsFor(hours: number, kind: DistanceKind): Record<Endurance | 'strength', number> {
  if (kind === 'run') {
    const run = RUN_SESSIONS_BY_HOURS.find((r) => hours <= r.maxHours)?.run ?? 5;
    return { swim: 0, bike: hours >= 5 ? 1 : 0, run, strength: 1 };
  }
  const row = SESSIONS_BY_HOURS.find((r) => hours <= r.maxHours) ?? SESSIONS_BY_HOURS[SESSIONS_BY_HOURS.length - 1];
  return { swim: row?.swim ?? 2, bike: row?.bike ?? 2, run: row?.run ?? 2, strength: row?.strength ?? 1 };
}

function strengthPlan(info: PhaseInfo, tableCount: number, minutes: number, freeWeek: boolean, light: boolean, wanted?: number): SessionSpec[] {
  const byPhase: Record<PhaseInfo['phase'], number> = { prep: 2, base: 2, build: 1, peak: 1, taper: 1, race_week: 0, recovery: 0, transition: 0 };
  const easy = info.isRecoveryWeek || freeWeek;
  // The athlete's own number, except in race and post-race weeks (no strength there).
  let count = wanted !== undefined && byPhase[info.phase] > 0 ? wanted : Math.min(byPhase[info.phase], tableCount, minutes < 300 ? 1 : 2);
  if (easy && count > 0) count = 1;
  const heavy = info.phase === 'base' && !easy && !light;
  return Array.from({ length: count }, () => ({
    code: heavy ? 'ST_HEAVY' : 'ST_MAINT',
    durationMin: heavy ? 45 : 30,
    priority: heavy ? 4 : 6,
  }));
}

/** Most quality sessions a beginner gets per week by phase (swim CSS included). [H] */
const BEGINNER_QUALITY_MAX: Readonly<Record<PhaseInfo['phase'], number>> = {
  prep: 0,
  base: 1,
  build: 2,
  peak: 1,
  taper: 1,
  race_week: 1,
  recovery: 0,
  transition: 0,
};

/**
 * Quality budget by intensity model: polarizado = at most 2 hard sessions (the
 * rest really easy); piramidal = one more tempo session in base. [H]
 */
function modelBudget(model: IntensityModel, info: PhaseInfo, budget: number): number {
  if (model === 'polarized') return Math.min(budget, 2);
  if (model === 'pyramidal' && info.phase === 'base') return budget + 1;
  return budget;
}

function qualityBudget(info: PhaseInfo, input: AllocationInput): number {
  let budget: number = modelBudget(input.prefs?.intensityModel ?? 'auto', info, QUALITY_BUDGET[info.phase]);
  if (input.level === 'beginner') budget = Math.min(budget, BEGINNER_QUALITY_MAX[info.phase]);
  // Recovery week inside a block: 1 short quality (2 in build at half work, §5.5); after a race or in a free week: none.
  if (info.phase === 'recovery' || info.phase === 'transition' || input.freeWeek) budget = 0;
  else if (info.isRecoveryWeek) budget = info.phase === 'build' ? 2 : 1;
  budget = Math.max(0, budget - input.qualityCut);
  return input.qualityCap === null ? budget : Math.min(budget, input.qualityCap);
}

function qualityCode(sport: 'bike' | 'run', info: PhaseInfo, kind: DistanceKind, distance: RaceDistance | null, index: number): SessionCode {
  const sub = info.subphase;
  if (info.phase === 'base' || info.phase === 'prep') {
    if (sport === 'bike') return sub === 'base3' ? 'BK_SST' : 'BK_TEMPO';
    if (kind === 'run' && index > 0) return 'RN_HILLS';
    return sub === 'base3' ? 'RN_HILLS' : 'RN_TEMPO';
  }
  if (info.phase === 'build') {
    if (kind === 'run') {
      const short = distance === 'run_5k' || distance === 'run_10k';
      return index === 0 ? (short ? 'RN_VO2' : 'RN_THR') : short ? 'RN_THR' : 'RN_TEMPO';
    }
    if (kind === 'tri_short' && sub === 'build2') return sport === 'bike' ? 'BK_VO2' : 'RN_VO2';
    return sport === 'bike' ? 'BK_THR' : 'RN_THR';
  }
  return sport === 'bike' ? 'BK_THR' : 'RN_THR';
}

/** Polarizado: no middle zone (tempo, sweet spot → threshold). Piramidal: the middle zone instead of the top (threshold, VO2 → tempo, sweet spot). */
const MODEL_CODE: Readonly<Record<Exclude<IntensityModel, 'auto'>, Partial<Record<SessionCode, SessionCode>>>> = {
  polarized: { BK_TEMPO: 'BK_THR', BK_SST: 'BK_THR', RN_TEMPO: 'RN_THR' },
  pyramidal: { BK_THR: 'BK_SST', BK_VO2: 'BK_SST', RN_THR: 'RN_TEMPO', RN_VO2: 'RN_TEMPO' },
};

function modelCode(model: IntensityModel | undefined, code: SessionCode): SessionCode {
  if (!model || model === 'auto') return code;
  return MODEL_CODE[model][code] ?? code;
}

function qualityMinutes(sport: Sport, hours: number, info: PhaseInfo): number {
  const base = sport === 'bike' ? (hours < 6 ? 60 : hours < 10 ? 75 : 90) : sport === 'run' ? (hours < 6 ? 45 : hours < 10 ? 50 : 60) : hours < 6 ? 40 : hours < 10 ? 50 : 60;
  const factor = info.isRecoveryWeek ? 0.75 : info.phase === 'taper' || info.phase === 'peak' ? 0.85 : 1;
  return round5(base * factor);
}

function longAllowed(sport: 'bike' | 'run', info: PhaseInfo, distance: RaceDistance | null): boolean {
  if (info.phase === 'race_week' || info.phase === 'transition' || info.phase === 'recovery') return false;
  if (info.phase === 'taper') return !(distance === 'full' || distance === 'run_marathon') && sport === 'bike';
  return true;
}

function longCap(sport: 'bike' | 'run', input: AllocationInput): number {
  const key: RaceDistance = input.distance ?? (input.kind === 'run' ? 'run_10k' : input.kind === 'tri_long' ? 'half' : 'olympic');
  const table = LONG_CAPS[key][sport];
  const data = sport === 'run' ? input.caps.runLongMax : input.caps.bikeLongMax;
  const taper = input.phase.phase === 'taper' || input.phase.phase === 'peak' ? 0.7 : 1;
  return Math.max(MIN_SESSION_MIN[sport], round5(Math.min(table * taper, data ?? Number.POSITIVE_INFINITY)));
}

interface SportPlanInput {
  sport: Endurance;
  minutes: number;
  count: number;
  qualities: SessionCode[];
  wantLong: boolean;
  longCapMin: number;
  hours: number;
  easyOnly: boolean;
  priorities: { long: number; quality: readonly number[]; filler: number };
  info: PhaseInfo;
  kind: DistanceKind;
  /**
   * Half/full distance in prep/base/build: the long session is the key of the
   * week, so with few minutes the sport gets fewer sessions rather than no long one.
   */
  keepLong?: boolean;
}

const FILLER: Record<Endurance, { code: SessionCode; max: number }> = {
  swim: { code: 'SW_END', max: 75 },
  bike: { code: 'BK_END', max: 120 },
  run: { code: 'RN_EASY', max: 60 },
};

/** Long-session share of the sport's weekly time by number of sessions (§8 templates ≈ 45-60 %). [H] */
function longShare(sport: Endurance, count: number): number {
  if (sport === 'bike') return count <= 2 ? 0.6 : count === 3 ? 0.5 : LONG_SHARE.bike;
  return count <= 2 ? 0.55 : count === 3 ? 0.45 : LONG_SHARE.run;
}

/** Session count for the sport: table count, limited by minimum useful duration, ≥ 2 when time allows (§8). */
function sessionCount(p: SportPlanInput, min: number): number {
  const byTime = Math.max(1, Math.floor(p.minutes / min));
  const count = Math.min(p.count, byTime);
  return p.count >= 2 && p.minutes >= 1.6 * min ? Math.max(count, 2) : count;
}

function longDuration(p: SportPlanInput, count: number): number {
  if (!p.wantLong || p.easyOnly || p.sport === 'swim') return 0;
  const longMin = p.sport === 'bike' ? 60 : 45;
  const raw = count === 1 ? p.minutes : p.minutes * longShare(p.sport, count);
  const dur = Math.min(p.longCapMin, round5(raw));
  return dur >= longMin ? dur : 0;
}

function sportSessions(p: SportPlanInput): SessionSpec[] {
  const min = MIN_SESSION_MIN[p.sport];
  if (p.count <= 0 || p.minutes < min * 0.8) return [];
  let count = sessionCount(p, min);
  let longDur = longDuration(p, count);
  while (p.keepLong && longDur === 0 && count > 1) {
    count -= 1;
    longDur = longDuration(p, count);
  }
  // A sport's only session is never a quality one: at least one easy or long session stays.
  const qualities = p.easyOnly ? [] : p.qualities.slice(0, Math.max(0, count - 1));
  let qDur = qualities.map(() => qualityMinutes(p.sport, p.hours, p.info));
  const qTotal = qDur.reduce((s, d) => s + d, 0);
  if (qTotal > 0 && longDur + qTotal > p.minutes) {
    const scale = Math.max(0, p.minutes - longDur) / qTotal;
    qDur = qDur.map((d) => Math.max(min, round5(d * scale)));
  }
  let fillers = count - qualities.length - (longDur > 0 ? 1 : 0);
  const shortfall = fillers * min * 0.8 - (p.minutes - longDur - qDur.reduce((s, d) => s + d, 0));
  if (fillers > 0 && shortfall > 0) {
    // Keep the session frequency: shorten the quality sessions before dropping an easy one.
    let toFree = shortfall;
    qDur = qDur.map((d) => {
      const cut = Math.min(toFree, Math.max(0, d - min));
      toFree -= cut;
      return round5(d - cut);
    });
  }
  const rest = p.minutes - longDur - qDur.reduce((s, d) => s + d, 0);
  while (fillers > 0 && rest / fillers < min * 0.8) fillers -= 1;
  const fillerMax = p.kind === 'run' && p.sport === 'run' ? 80 : FILLER[p.sport].max;
  const fillerDur = fillers > 0 ? Math.min(fillerMax, Math.max(min, round5(rest / fillers))) : 0;
  const leftover = Math.max(0, rest - fillers * fillerDur);
  const out: SessionSpec[] = [];
  if (longDur > 0) {
    const extended = Math.min(p.longCapMin, round5(longDur + leftover));
    out.push({ code: p.sport === 'bike' ? 'BK_LONG' : 'RN_LONG', durationMin: extended, priority: p.priorities.long });
  }
  qualities.forEach((code, i) => {
    const extra = longDur === 0 && i === 0 ? Math.min(15, round5(leftover)) : 0;
    out.push({ code, durationMin: (qDur[i] ?? 45) + extra, priority: p.priorities.quality[i] ?? 3 });
  });
  for (let i = 0; i < fillers; i += 1) {
    const code: SessionCode = p.sport === 'swim' && i === fillers - 1 && out.length > 0 ? 'SW_TECH' : FILLER[p.sport].code;
    // Only a 3rd+ swim is "extra" technique (priority 7, §9); the 2nd swim keeps filler priority.
    const priority = code === 'SW_TECH' && out.length >= 2 ? 7 : p.priorities.filler;
    out.push({ code, durationMin: code === 'SW_TECH' ? Math.min(fillerDur, 45) : fillerDur, priority });
  }
  return out;
}

function swimCodes(info: PhaseInfo, count: number, freeWeek: boolean, roomLeft: boolean): SessionCode[] {
  const cssAllowed = roomLeft && !freeWeek && !info.isRecoveryWeek && info.subphase !== 'base1' && info.phase !== 'prep' && info.phase !== 'transition' && info.phase !== 'recovery' && info.phase !== 'race_week';
  return count >= 2 && cssAllowed ? ['SW_CSS'] : [];
}

const PRIORITIES: Record<DistanceKind, { bikeLong: number; runLong: number; q: readonly number[]; brick: number; swimMain: number }> = {
  tri_long: { bikeLong: 1, runLong: 1, q: [2, 3], brick: 1, swimMain: 4 },
  tri_short: { bikeLong: 3, runLong: 2, q: [1, 2], brick: 2, swimMain: 3 },
  run: { bikeLong: 5, runLong: 1, q: [1, 2], brick: 2, swimMain: 5 },
};

interface QualityAssignment {
  bike: SessionCode[];
  run: SessionCode[];
  shortBrick: boolean;
  longBrick: boolean;
  /** Quality sessions the budget still allows after bike, run and bricks. */
  left: number;
}

function assignQualities(input: AllocationInput, counts: Record<Endurance, number>): QualityAssignment {
  const { phase: info, kind, distance } = input;
  let budget = qualityBudget(info, input);
  const result: QualityAssignment = { bike: [], run: [], shortBrick: false, longBrick: false, left: 0 };
  const tri = kind !== 'run' && counts.bike > 0 && counts.run > 0;
  const brickPhase = (info.phase === 'build' || info.phase === 'peak') && !info.isRecoveryWeek;
  if (tri && brickPhase && kind === 'tri_long' && budget > 0) {
    result.longBrick = true;
    budget -= 1;
  }
  const order: ('bike' | 'run' | 'brick')[] =
    kind === 'tri_long' ? ['bike', 'run'] : kind === 'tri_short' ? (brickPhase ? ['run', 'bike', 'brick'] : ['run', 'bike']) : ['run', 'run'];
  for (const slot of order) {
    if (budget <= 0) break;
    if (slot === 'brick') {
      if (tri) {
        result.shortBrick = true;
        budget -= 1;
      }
      continue;
    }
    if (counts[slot] === 0) continue;
    const list = result[slot];
    list.push(modelCode(input.prefs?.intensityModel, qualityCode(slot, info, kind, distance, list.length)));
    budget -= 1;
  }
  return { ...result, left: Math.max(0, budget) };
}

/**
 * «Tu forma de entrenar»: a sport the athlete wants more (or fewer) sessions of
 * gets more (or less) of the week's time, so the sessions keep a useful length:
 * the phase's share × wanted / usual sessions (between ½ and 2×); 0 sessions = no time.
 */
function weightedSplit(split: SportSplit, usual: Record<Endurance, number>, wanted: Partial<Record<Endurance | 'strength', number>>): SportSplit {
  const weight = (sport: Endurance): number => {
    const n = wanted[sport];
    if (n === undefined) return 1;
    if (n === 0) return 0;
    return Math.min(2, Math.max(0.5, n / Math.max(1, usual[sport])));
  };
  return { ...split, swim: split.swim * weight('swim'), bike: split.bike * weight('bike'), run: split.run * weight('run') };
}

function normalizeSplit(split: SportSplit, sports: readonly TrainableSport[]): Record<Endurance, number> {
  const raw: Record<Endurance, number> = {
    swim: sports.includes('swim') ? split.swim : 0,
    bike: sports.includes('bike') ? split.bike : 0,
    run: sports.includes('run') ? split.run : 0,
  };
  const total = raw.swim + raw.bike + raw.run;
  if (total <= 0) return { swim: 0, bike: 0, run: 0 };
  return { swim: raw.swim / total, bike: raw.bike / total, run: raw.run / total };
}

function applySubstitutes(minutes: Record<Endurance, number>, input: AllocationInput): { minutes: Record<Endurance, number>; easyOnly: Set<Sport> } {
  const out = { ...minutes };
  const easyOnly = new Set<Sport>(input.easyOnlyAllWeek);
  for (const sport of input.blockedAllWeek) {
    if (sport !== 'swim' && sport !== 'bike' && sport !== 'run') continue;
    const sub = input.substitutes[sport];
    const moved = out[sport];
    out[sport] = 0;
    if (sub === 'swim' || sub === 'bike' || sub === 'run') {
      out[sub] += moved * (sub === 'bike' ? (SUBSTITUTION_RATIO.bike ?? 1) : 1);
      easyOnly.add(sub);
    }
  }
  return { minutes: out, easyOnly };
}

function totalMinutes(specs: readonly SessionSpec[]): number {
  return specs.reduce((sum, s) => sum + s.durationMin, 0);
}

/** Long and quality sessions of a sport plan: what the week cannot lose. */
function keyCodes(specs: readonly SessionSpec[]): SessionCode[] {
  return specs.filter((s) => s.priority < 5).map((s) => s.code);
}

/**
 * Weekly run cap: when the runs (plus the bricks' run leg) go over `max`, the
 * run sessions are planned again with the minutes left and as few sessions
 * as needed for the long run and the quality run of the full plan to survive
 * (easy runs go first). `freed` = the run minutes taken out.
 */
function capRunPlan(p: SportPlanInput, full: SessionSpec[], max: number | null | undefined, brickRunMin: number): { run: SessionSpec[]; freed: number } {
  const room = max === null || max === undefined ? null : Math.max(0, max - brickRunMin);
  const before = totalMinutes(full);
  if (room === null || before <= room) return { run: full, freed: 0 };
  const keys = keyCodes(full);
  const plans = Array.from({ length: Math.max(1, p.count) }, (_, i) => sportSessions({ ...p, minutes: room, count: Math.max(1, p.count) - i }));
  const run = plans.find((plan) => keys.every((code) => plan.some((s) => s.code === code))) ?? plans[plans.length - 1] ?? [];
  return { run, freed: Math.max(0, before - totalMinutes(run)) };
}

/** Triathletes get the freed run minutes on the bike and in the pool (aerobic volume without the impact); run-only plans just lose them. */
function withFreedRunMinutes(minutes: Record<Endurance, number>, freed: number, kind: DistanceKind): Record<Endurance, number> {
  const others = kind === 'run' ? 0 : minutes.swim + minutes.bike;
  if (freed <= 0 || others <= 0) return minutes;
  return { ...minutes, swim: minutes.swim + (freed * minutes.swim) / others, bike: minutes.bike + (freed * minutes.bike) / others };
}

interface BrickPlan {
  runMin: number;
  shortBikeMin: number;
}

function brickPlan(q: QualityAssignment, info: PhaseInfo, distance: RaceDistance | null, hours: number): BrickPlan {
  if (q.longBrick) return { runMin: info.phase === 'peak' ? 20 : distance === 'full' ? 45 : 30, shortBikeMin: 0 };
  if (q.shortBrick) return { runMin: hours < 7 ? 15 : 20, shortBikeMin: hours < 7 ? 45 : 55 };
  return { runMin: 0, shortBikeMin: 0 };
}

function brickSessions(q: QualityAssignment, bp: BrickPlan, bike: SessionSpec[], brickPriority: number): { bike: SessionSpec[]; bricks: SessionSpec[] } {
  const longBike = bike.find((s) => s.code === 'BK_LONG');
  if (q.longBrick && longBike) {
    const brick: SessionSpec = { code: 'BRICK', durationMin: round5(longBike.durationMin + bp.runMin), brickRunMin: bp.runMin, racePace: true, priority: 1, longBrick: true };
    return { bike: bike.filter((s) => s !== longBike), bricks: [brick] };
  }
  if (q.longBrick || q.shortBrick) {
    const bikeMin = bp.shortBikeMin > 0 ? bp.shortBikeMin : 45;
    return { bike, bricks: [{ code: 'BRICK', durationMin: round5(bikeMin + bp.runMin), brickRunMin: bp.runMin, racePace: true, priority: brickPriority }] };
  }
  return { bike, bricks: [] };
}

/** Ideal (unplaced) sessions of the week. */
export function allocateSessions(input: AllocationInput): SessionSpec[] {
  return allocateWeek(input).specs;
}

/** Ideal (unplaced) sessions of the week and how much the weekly run cap took out. */
export function allocateWeek(input: AllocationInput): AllocationResult {
  const { phase: info, kind, distance } = input;
  if (input.minutes <= 0) return { specs: [], runCappedMin: 0 };
  const hours = input.minutes / 60;
  const counts = countsFor(hours, kind);
  const free = input.freeWeek === true;
  const light = input.lightStrength === true || input.level === 'beginner';
  const wanted = input.prefs?.sessionsPerWeek ?? {};
  const strength = input.sports.includes('strength') && !input.blockedAllWeek.includes('strength') ? strengthPlan(info, counts.strength, input.minutes, free, light, wanted.strength) : [];
  const strengthMin = strength.reduce((s, x) => s + x.durationMin, 0);
  const enduranceMin = Math.max(0, input.minutes - strengthMin);
  const shares = normalizeSplit(weightedSplit(splitFor(info, kind, distance), counts, wanted), input.sports);
  const base: Record<Endurance, number> = { swim: enduranceMin * shares.swim, bike: enduranceMin * shares.bike, run: enduranceMin * shares.run };
  const { minutes: split, easyOnly } = applySubstitutes(base, input);
  const sportCounts: Record<Endurance, number> = {
    swim: split.swim > 0 ? (wanted.swim ?? Math.max(counts.swim, input.blockedAllWeek.length > 0 ? 2 : 0)) : 0,
    bike: split.bike > 0 ? (wanted.bike ?? Math.max(counts.bike, 1)) : 0,
    run: split.run > 0 ? (wanted.run ?? Math.max(counts.run, 1)) : 0,
  };
  const q: QualityAssignment = info.phase === 'race_week' ? { bike: [], run: [], shortBrick: false, longBrick: false, left: 0 } : assignQualities(input, sportCounts);
  // Swim CSS is extra quality for most athletes; beginners and capped weeks (exams, work) count it in the budget.
  const cssRoom = (input.level !== 'beginner' && input.qualityCap === null) || q.left > 0;
  const keepLong = kind === 'tri_long' && (info.phase === 'prep' || info.phase === 'base' || info.phase === 'build');
  const pr = PRIORITIES[kind];
  const bp = brickPlan(q, info, distance, hours);
  const planInput = (sport: Endurance, qualities: SessionCode[], wantLong: boolean, minutesFor: number, longPriority: number): SportPlanInput => ({
    sport,
    minutes: minutesFor,
    count: sportCounts[sport],
    qualities,
    wantLong,
    longCapMin: sport === 'swim' ? 75 : longCap(sport, input),
    hours,
    easyOnly: easyOnly.has(sport),
    priorities: { long: longPriority, quality: pr.q, filler: 5 },
    info,
    kind,
    keepLong: keepLong && sport !== 'swim',
  });
  const plan = (sport: Endurance, qualities: SessionCode[], wantLong: boolean, minutesFor: number, longPriority: number): SessionSpec[] =>
    sportSessions(planInput(sport, qualities, wantLong, minutesFor, longPriority));
  const runInput = planInput('run', q.run, !free && longAllowed('run', info, distance), split.run - bp.runMin, pr.runLong);
  const capped = capRunPlan(runInput, sportSessions(runInput), input.caps.runWeekMax, bp.runMin);
  const run = capped.run;
  const minutes = withFreedRunMinutes(split, capped.freed, kind);
  const swim = plan('swim', swimCodes(info, sportCounts.swim, free, cssRoom), false, minutes.swim, pr.swimMain).map((s) =>
    s.code === 'SW_CSS' || s.code === 'SW_END' ? { ...s, priority: Math.min(s.priority, pr.swimMain) } : s,
  );
  const bikeRaw = plan('bike', q.bike, !free && longAllowed('bike', info, distance) && kind !== 'run', minutes.bike - bp.shortBikeMin, pr.bikeLong);
  const { bike, bricks } = brickSessions(q, bp, bikeRaw, pr.brick);
  const racePhase = info.phase === 'build' || info.phase === 'peak';
  const decorated = [...bike, ...run].map((s): SessionSpec => {
    if (s.code === 'BK_LONG' && info.phase === 'base' && kind !== 'run' && split.run > 0) {
      return { ...s, note: "Opcional: 10-15' de carrera suave al bajarte de la bici." };
    }
    if (s.code === 'BK_LONG') return { ...s, racePace: racePhase };
    // In long-distance builds the brick carries race pace; the long run stays Z1-Z2 (BIG_WEEKEND rule).
    if (s.code === 'RN_LONG') return { ...s, racePace: racePhase && kind !== 'tri_long' };
    return s;
  });
  return { specs: [...bricks, ...decorated, ...swim, ...strength], runCappedMin: Math.round(capped.freed) };
}
