// GENERATED MIRROR of src/domain/periodization.ts — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/**
 * Macrocycle periodization counted backwards from the target race
 * (docs/research/02 §5): race week → taper/peak → build → base → prep,
 * with 3:1 (or 2:1) recovery cadence and per-distance taper factors.
 *
 * Plan length: from the previous A race's transition, else from the week the
 * A race was added (`race.createdAt`), so the layout is stable week to week.
 * Shorter than the minimum viable length → "survival" plan (base + taper) and
 * a PLAN_TOO_SHORT warning, unless the athlete (not a beginner) already trains
 * the base volume of the distance (`recentWeeklyMinutes` ≥ BASE_READY_HOURS):
 * then a short base and a build block with the same race and taper weeks.
 * Recovery weeks close each base/build subphase (recoveryLayout.ts).
 */
import {
  BASE_READY_HOURS,
  BLOCK_PROGRESSION_21,
  BLOCK_PROGRESSION_31,
  B_RACE_WEEK_FACTOR,
  C_RACE_WEEK_FACTOR,
  FITNESS_WEEKS,
  PHASE_TABLE,
  POST_B_RECOVERY_FACTOR,
  READY_BASE_SHARE,
  RECOVERY_FACTOR_21,
  RECOVERY_FACTOR_31,
  SPECIFIC_PREP_SESSIONS,
  TAPER_FACTORS,
  TRANSITION_FACTOR,
  VOLUME_CURVE,
  type DistanceKind,
  type Subphase,
} from './constants.ts';
import { addDays, diffDays, isISODate, startOfWeek, weekRange } from './dates.ts';
import { loadWeeks, type RecoveryCadence } from './recoveryLayout.ts';
import type { AthleteLevel, ISODate, Race, RaceDistance, RacePrep, TrainableSport } from './types.ts';

export type Phase = 'prep' | 'base' | 'build' | 'peak' | 'taper' | 'race_week' | 'recovery' | 'transition';
export type { RecoveryCadence };

export interface PhaseInfo {
  phase: Phase;
  targetRace: Race | null;
  weeksToRace: number | null;
  daysToRace: number | null;
  isRecoveryWeek: boolean;
  /** Multiplier over the athlete's weekly hours target. */
  volumeFactor: number;
  /** Spanish one-liner. */
  focus: string;
  /** Extension: finer phase (base1..build2, maintenance) when applicable. */
  subphase: Subphase | null;
  cadence: RecoveryCadence;
  /** Another race (B/C) or the target race happening this week. */
  raceInWeek: Race | null;
  /**
   * A B/C race prepared with 'specific' («Preparación específica») in the 2
   * weeks after this one: this many of the week's race-pace sessions target it.
   * Only in prep/base/build weeks of a plan towards an A race; null otherwise.
   */
  specificPrep: SpecificPrep | null;
  /** Spanish warnings (races too close…). */
  warnings: string[];
}

export interface SpecificPrep {
  race: Race;
  /** Race-pace sessions of the week for that race: 1 two weeks before its race week, 2 the week before. */
  sessions: number;
}

export interface PhaseOptions {
  level?: AthleteLevel;
  /** High life stress recently → 2:1 cadence. */
  lifeStress?: boolean;
  /**
   * Completed minutes of the athlete's latest weeks (oldest first; the last
   * FITNESS_WEEKS count): when the A race is too close for a full plan, a
   * non-beginner who already trains the base volume of the distance gets base
   * + build instead of the survival plan. Absent or too little history = no change.
   */
  recentWeeklyMinutes?: readonly number[];
}

interface WeekSlot {
  phase: Phase;
  subphase: Subphase | null;
  /** Taper factor relative to the average build week (taper/peak/race week). */
  taper: number | null;
  isRecovery: boolean;
  /** Load-week progression inside the block (or the recovery factor). */
  progression: number;
}

const PRIORITY_RANK: Record<Race['priority'], number> = { A: 0, B: 1, C: 2 };

function sortRaces(races: readonly Race[]): Race[] {
  return [...races].sort((a, b) => a.date.localeCompare(b.date) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id));
}

/**
 * How a B or C race is prepared: its own choice, else the priority's default
 * (B → 'taper', C → 'training'); null for A races (they always get the full taper).
 */
export function racePrepOf(race: Pick<Race, 'priority' | 'prep'>): RacePrep | null {
  if (race.priority === 'A') return null;
  return race.prep ?? (race.priority === 'B' ? 'taper' : 'training');
}

/** Next A race on/after `today`, else the next race of any priority. */
export function nextRace(races: readonly Race[], today: ISODate): Race | null {
  const upcoming = sortRaces(races).filter((r) => r.date >= today);
  return upcoming.find((r) => r.priority === 'A') ?? upcoming[0] ?? null;
}

/** Distance family for volume/split/priority tables. */
export function distanceKindOf(distance: RaceDistance | null, sports: readonly TrainableSport[] = ['swim', 'bike', 'run']): DistanceKind {
  if (distance === 'half' || distance === 'full') return 'tri_long';
  if (distance === 'run_5k' || distance === 'run_10k' || distance === 'run_half' || distance === 'run_marathon') return 'run';
  if (distance === null && !sports.includes('swim') && !sports.includes('bike') && sports.includes('run')) return 'run';
  return 'tri_short';
}

function curveFor(distance: RaceDistance | null) {
  if (distance === 'full') return VOLUME_CURVE.full;
  return VOLUME_CURVE[distanceKindOf(distance)];
}

interface Allocation {
  prep: number;
  base: number;
  build: number;
  taperWeeks: number;
  warnings: string[];
}

/** PLAN_TOO_SHORT (§5.2): stronger for a full distance. */
function tooShortWarning(distance: RaceDistance, minViable: number): string {
  const base = `Quedan menos de ${minViable} semanas hasta la carrera: no da tiempo a un plan completo, así que hacemos un plan de supervivencia (base aeróbica y puesta a punto, sin bloque específico).`;
  return distance === 'full' ? `${base} Para una distancia completa es muy poco: plantéate una distancia menor o ir a terminarla, no a competirla.` : base;
}

/** Race week + 1 taper week when there are 2 weeks or more: the short plans (survival or not) share them. */
function shortTaperWeeks(available: number): number {
  return available >= 2 ? 1 : 0;
}

/** Below the minimum viable length: race week + 1 taper week + base (no build). §5.2 */
function survival(distance: RaceDistance, available: number): Allocation {
  const taperWeeks = shortTaperWeeks(available);
  const base = Math.max(0, available - 1 - taperWeeks);
  return { prep: 0, base, build: 0, taperWeeks, warnings: [tooShortWarning(distance, PHASE_TABLE[distance].minViable)] };
}

/**
 * Below the minimum viable length, but the athlete already trains the base
 * volume of the distance: the survival plan's race and taper weeks (so the
 * weeks a WeekPlan cannot change are the same), then a short base (a third of
 * the training weeks) and build for the rest, up to its ideal length.
 */
function readyShortPlan(distance: RaceDistance, available: number): Allocation {
  const D = PHASE_TABLE[distance];
  const taperWeeks = shortTaperWeeks(available);
  const training = Math.max(0, available - 1 - taperWeeks);
  const build = Math.min(D.build.ideal, training - Math.round(training * READY_BASE_SHARE));
  const warning = `Quedan menos de ${D.minViable} semanas hasta la carrera, pero tu volumen de las últimas semanas ya cubre la base: hacemos una base corta y un bloque específico comprimido.`;
  return { prep: 0, base: training - build, build, taperWeeks, warnings: [warning] };
}

/**
 * The athlete's current volume: the average completed minutes of the last
 * FITNESS_WEEKS weeks given (oldest first), or null with fewer than 2 weeks
 * with training (not enough history to judge).
 */
export function fitnessWeeklyMinutes(weeks: readonly number[] | undefined): number | null {
  const last = (weeks ?? []).filter((m) => Number.isFinite(m) && m >= 0).slice(-FITNESS_WEEKS);
  if (last.filter((m) => m > 0).length < 2) return null;
  return last.reduce((sum, m) => sum + m, 0) / last.length;
}

/** A non-beginner whose recent volume already covers the base of the distance (BASE_READY_HOURS). */
function baseCovered(distance: RaceDistance, opts: PhaseOptions): boolean {
  if (opts.level !== 'intermediate' && opts.level !== 'advanced') return false;
  const minutes = fitnessWeeklyMinutes(opts.recentWeeklyMinutes);
  return minutes !== null && minutes >= BASE_READY_HOURS[distance] * 60;
}

/**
 * Doc §5.2 allocation; `available` = weeks from plan start to race week
 * inclusive (null = open). `covered`: the base is already trained (see readyShortPlan).
 */
function allocate(distance: RaceDistance, available: number | null, withTaper: boolean, covered: boolean): Allocation {
  const D = PHASE_TABLE[distance];
  const taperWeeks = withTaper ? (TAPER_FACTORS[distance].minus2 !== null ? 2 : 1) : 0;
  if (available === null) return { prep: 0, base: D.base.max, build: D.build.ideal, taperWeeks, warnings: [] };
  if (withTaper && available < D.minViable) return covered ? readyShortPlan(distance, available) : survival(distance, available);
  const alloc = { prep: D.prep.ideal, base: D.base.ideal, build: D.build.ideal, taperWeeks };
  const total = () => 1 + alloc.taperWeeks + alloc.build + alloc.base + alloc.prep;
  if (total() <= available) {
    alloc.base += Math.min(available - total(), D.base.max - D.base.ideal);
    // Weeks left before the plan are maintenance base: the athlete is already training, so no prep phase.
    if (total() < available) alloc.prep = 0;
    return { ...alloc, warnings: [] };
  }
  const steps: (() => void)[] = [
    () => (alloc.prep = Math.max(D.prep.min, alloc.prep - (total() - available))),
    () => (alloc.base = Math.max(D.base.min, alloc.base - (total() - available))),
    () => (alloc.build = Math.max(D.build.min, alloc.build - (total() - available))),
    () => (alloc.taperWeeks = Math.max(withTaper ? 1 : 0, alloc.taperWeeks - (total() - available))),
  ];
  for (const step of steps) if (total() > available) step();
  const warnings = total() > available ? ['Hay poco tiempo hasta la carrera: plan comprimido (base corta y puesta a punto).'] : [];
  return { ...alloc, warnings };
}

/** Backward layout: index 0 = race week, 1 = week before… */
function layout(distance: RaceDistance, alloc: Allocation, cadence: RecoveryCadence): WeekSlot[] {
  const T = TAPER_FACTORS[distance];
  const taper = (phase: Phase, factor: number): WeekSlot => ({ phase, subphase: null, taper: factor, isRecovery: false, progression: 1 });
  const slots: WeekSlot[] = [taper('race_week', T.raceWeek)];
  if (alloc.taperWeeks >= 1) slots.push(taper('taper', T.minus1));
  if (alloc.taperWeeks >= 2) slots.push(taper('peak', T.minus2 ?? T.minus1));
  const load = loadWeeks({ prep: alloc.prep, base: alloc.base, build: alloc.build }, cadence).map((w): WeekSlot => ({ ...w, taper: null }));
  return [...slots, ...load.reverse()];
}

const FOCUS: Record<Phase, string> = {
  prep: 'Volvemos a la rutina: fondo suave, técnica y fuerza general.',
  base: 'Semana de base: construimos el motor aeróbico.',
  build: 'Semana específica: ritmo de carrera, series y bricks.',
  peak: 'Pico: bajamos algo el volumen y mantenemos la intensidad.',
  taper: 'Reducimos volumen y mantenemos la chispa para llegar fresco.',
  race_week: 'Semana de carrera: activaciones cortas y mucho descanso.',
  recovery: 'Recuperación tras la carrera: todo suave y sin prisas.',
  transition: 'Transición: recupera cuerpo y cabeza con actividad libre.',
};

const RECOVERY_FOCUS = 'Semana de descarga: asimilamos el trabajo.';
const MAINTENANCE_FOCUS = 'Sin carrera cerca: base de mantenimiento con descargas cada pocas semanas.';

function cadenceFor(opts: PhaseOptions): RecoveryCadence {
  return opts.level === 'beginner' || opts.lifeStress === true ? '2:1' : '3:1';
}

interface CycleInfo {
  isRecovery: boolean;
  progression: number;
}

/** Position inside the load/recovery cycle; p = 0 is the load week nearest the taper. */
function cycleAt(p: number, cadence: RecoveryCadence): CycleInfo {
  const cycle = cadence === '3:1' ? 4 : 3;
  const pos = ((p % cycle) + cycle) % cycle;
  if (pos === cycle - 1) return { isRecovery: true, progression: cadence === '3:1' ? RECOVERY_FACTOR_31 : RECOVERY_FACTOR_21 };
  const prog = cadence === '3:1' ? BLOCK_PROGRESSION_31 : BLOCK_PROGRESSION_21;
  return { isRecovery: false, progression: prog[cycle - 2 - pos] ?? 1 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function baseInfo(phase: Phase, target: Race | null, date: ISODate): Pick<PhaseInfo, 'phase' | 'targetRace' | 'weeksToRace' | 'daysToRace'> {
  if (!target) return { phase, targetRace: null, weeksToRace: null, daysToRace: null };
  return {
    phase,
    targetRace: target,
    weeksToRace: Math.max(0, Math.round(diffDays(startOfWeek(target.date), startOfWeek(date)) / 7)),
    daysToRace: diffDays(target.date, date),
  };
}

/**
 * Maintenance base volume. Ahead of a target race it never exceeds the first
 * base week, so volume does not drop when the macrocycle starts (§5.2).
 */
function maintenanceFactor(target: Race | null, cadence: RecoveryCadence, cycle: CycleInfo): number {
  const curve = curveFor(target?.distance ?? null);
  const own = curve.maintenance * cycle.progression;
  if (!target) return own;
  const firstLoad = (cadence === '3:1' ? BLOCK_PROGRESSION_31 : BLOCK_PROGRESSION_21)[0];
  return Math.min(own, curve.base1 * firstLoad);
}

/**
 * Monday whose week has index 0. Chosen so the index equals the ISO week number
 * all through 2026 (the cycle in use when it replaced `isoWeekNumber`), and it
 * keeps counting across New Year: ISO numbers restart at 1 after week 52 or 53,
 * which ran 4 load weeks in a row (3:1) or two descargas 2 weeks apart (2:1).
 */
const MAINTENANCE_ANCHOR: ISODate = '2025-12-22';

function continuousWeekIndex(date: ISODate): number {
  return Math.round(diffDays(startOfWeek(date), MAINTENANCE_ANCHOR) / 7);
}

/**
 * Maintenance load/recovery cycle. Before a planned macrocycle it is counted
 * back from the plan start (`weeksBeforePlan` = 0 is the week right before it),
 * which is always a recovery week, so the cadence never runs on across the
 * boundary; otherwise it follows a continuous week index (counted backwards, so
 * the load weeks after each descarga build up 0.95 → 1.00 → 1.05 like a plan).
 */
function maintenanceCycle(date: ISODate, cadence: RecoveryCadence, weeksBeforePlan: number | null): CycleInfo {
  const cycle = cadence === '3:1' ? 4 : 3;
  if (weeksBeforePlan === null) return cycleAt(cycle - 2 - continuousWeekIndex(date), cadence);
  return cycleAt(weeksBeforePlan + cycle - 1, cadence);
}

function maintenanceInfo(date: ISODate, target: Race | null, cadence: RecoveryCadence, warnings: string[], weeksBeforePlan: number | null = null): PhaseInfo {
  const cycle = maintenanceCycle(date, cadence, weeksBeforePlan);
  const factor = round2(maintenanceFactor(target, cadence, cycle));
  return {
    ...baseInfo('base', target, date),
    isRecoveryWeek: cycle.isRecovery,
    volumeFactor: factor,
    focus: cycle.isRecovery ? RECOVERY_FOCUS : target ? FOCUS.base : MAINTENANCE_FOCUS,
    subphase: 'maintenance',
    cadence,
    raceInWeek: null,
    specificPrep: null,
    warnings,
  };
}

/**
 * Transition after an A race; easy days after a B/C race prepared with 'taper'
 * or 'specific'. A race done 'training' (como un entreno) needs no recovery week.
 */
function recentRaceState(sorted: Race[], date: ISODate): { race: Race; kind: 'transition' | 'recovery' } | null {
  const past = sorted.filter((r) => r.date < date && racePrepOf(r) !== 'training');
  const last = past[past.length - 1];
  if (!last) return null;
  const days = diffDays(date, last.date);
  const window = PHASE_TABLE[last.distance].transitionDays;
  if (last.priority === 'A' && days <= window) return { race: last, kind: 'transition' };
  if (last.priority !== 'A' && days <= Math.ceil(window / 2)) return { race: last, kind: 'recovery' };
  return null;
}

/** Weeks from the week the A race was added (stable plan anchor) to race week, inclusive. */
function anchoredWeeks(target: Race): number | null {
  const created = (target.createdAt ?? '').slice(0, 10);
  if (target.priority !== 'A' || !isISODate(created) || created > target.date) return null;
  return Math.floor(diffDays(startOfWeek(target.date), startOfWeek(created)) / 7) + 1;
}

function availableWeeks(sorted: Race[], target: Race): { weeks: number | null; warnings: string[] } {
  const previous = sorted.filter((r) => r.priority === 'A' && r.date < target.date && r.id !== target.id);
  const prev = previous[previous.length - 1];
  if (!prev) return { weeks: anchoredWeeks(target), warnings: [] };
  const start = addDays(prev.date, PHASE_TABLE[prev.distance].transitionDays);
  const weeks = Math.floor(diffDays(startOfWeek(target.date), startOfWeek(start)) / 7) + 1;
  const tooClose = weeks < 8 && (prev.distance === 'full' || target.distance === 'full');
  return {
    weeks: Math.max(1, weeks),
    warnings: tooClose ? ['Dos carreras A muy seguidas con una de distancia completa: revisa el objetivo.'] : [],
  };
}

function raceInWeekOf(sorted: Race[], date: ISODate): Race | null {
  const range = weekRange(date);
  const inWeek = sorted.filter((r) => r.date >= range.from && r.date <= range.to);
  return [...inWeek].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0] ?? null;
}

/** Race-week volume of a B/C race: the mini-taper unless it is done 'training' (como un entreno). */
function minorRaceWeekFactor(prep: RacePrep): number {
  return prep === 'training' ? C_RACE_WEEK_FACTOR : B_RACE_WEEK_FACTOR;
}

const RACE_WEEK_NOTE: Readonly<Record<RacePrep, string>> = {
  training: 'como un entreno, el día antes suave.',
  taper: 'mini-taper de 3-5 días.',
  specific: 'mini-taper de 3-5 días tras su preparación específica.',
};

function raceWeekAdjust(info: PhaseInfo, race: Race | null): PhaseInfo {
  if (!race || race.id === info.targetRace?.id || info.phase === 'race_week') return { ...info, raceInWeek: race ?? info.raceInWeek };
  const prep = racePrepOf(race);
  if (prep === null) return { ...info, raceInWeek: race };
  const note = ` Carrera ${race.priority} esta semana: ${RACE_WEEK_NOTE[prep]}`;
  return { ...info, raceInWeek: race, volumeFactor: round2(info.volumeFactor * minorRaceWeekFactor(prep)), focus: `${info.focus}${note}` };
}

/** "1 sesión" / "2 sesiones". */
function sessionsText(n: number): string {
  return n === 1 ? '1 sesión' : `${n} sesiones`;
}

/**
 * The 'specific' B/C race whose race week is 1 or 2 weeks after this one, in a
 * prep/base/build week of a plan towards an A race (the A race keeps the
 * phases, the volume and the long sessions); its race-pace sessions this week
 * target that race. The focus says so.
 */
function withSpecificPrep(info: PhaseInfo, sorted: readonly Race[], weekStart: ISODate): PhaseInfo {
  const target = info.targetRace;
  if (!target || target.priority !== 'A' || !['prep', 'base', 'build'].includes(info.phase)) return info;
  for (const race of sorted) {
    if (race.id === target.id || racePrepOf(race) !== 'specific') continue;
    const weeksBefore = Math.round(diffDays(startOfWeek(race.date), weekStart) / 7);
    const sessions = weeksBefore >= 1 ? SPECIFIC_PREP_SESSIONS[weeksBefore - 1] : undefined;
    if (sessions) {
      const note = ` Preparación específica para ${race.name}: ${sessionsText(sessions)} a su ritmo.`;
      return { ...info, specificPrep: { race, sessions }, focus: `${info.focus}${note}` };
    }
  }
  return info;
}

function postRaceInfo(state: { race: Race; kind: 'transition' | 'recovery' }, target: Race | null, date: ISODate, cadence: RecoveryCadence): PhaseInfo {
  return {
    ...baseInfo(state.kind, target, date),
    isRecoveryWeek: true,
    volumeFactor: state.kind === 'transition' ? TRANSITION_FACTOR : POST_B_RECOVERY_FACTOR,
    focus: FOCUS[state.kind],
    subphase: null,
    cadence,
    raceInWeek: null,
    specificPrep: null,
    warnings: [],
  };
}

/**
 * Training phase, volume factor and focus for the week containing `date`.
 * Everything but `daysToRace` is evaluated on the week's Monday, so every day of
 * a week gets the same phase as the planner, which plans from Monday (Hoy, the
 * briefing and the replanner pass today's date).
 */
export function phaseFor(date: ISODate, races: readonly Race[], opts: PhaseOptions = {}): PhaseInfo {
  const sorted = sortRaces(races);
  const cadence = cadenceFor(opts);
  const weekStart = startOfWeek(date);
  const target = nextRace(sorted, weekStart);
  const recent = recentRaceState(sorted, weekStart);
  const k = target ? Math.round(diffDays(startOfWeek(target.date), weekStart) / 7) : null;
  if (recent && (k === null || k > 1)) return postRaceInfo(recent, target, date, cadence);
  if (!target || k === null) return maintenanceInfo(date, null, cadence, []);

  const avail = availableWeeks(sorted, target);
  const alloc = allocate(target.distance, avail.weeks, target.priority === 'A', baseCovered(target.distance, opts));
  const slots = layout(target.distance, alloc, cadence);
  const warnings = [...avail.warnings, ...alloc.warnings];
  const slot = slots[k];
  const finish = (info: PhaseInfo): PhaseInfo => withSpecificPrep(raceWeekAdjust(info, raceInWeekOf(sorted, date)), sorted, weekStart);
  if (!slot) return finish(maintenanceInfo(date, target, cadence, warnings, k - slots.length));

  const curve = curveFor(target.distance);
  const buildAvg = (curve.build1 + curve.build2) / 2;
  if (slot.taper !== null) {
    // A B/C race as the target (no A race): the race week of its own preparation.
    const prep = slot.phase === 'race_week' ? racePrepOf(target) : null;
    const factor = prep !== null ? curve.build2 * minorRaceWeekFactor(prep) : buildAvg * slot.taper;
    return finish({
      ...baseInfo(slot.phase, target, date),
      isRecoveryWeek: false,
      volumeFactor: round2(factor),
      focus: FOCUS[slot.phase],
      subphase: null,
      cadence,
      raceInWeek: null,
      specificPrep: null,
      warnings,
    });
  }
  const subphase = slot.subphase ?? 'maintenance';
  return finish({
    ...baseInfo(slot.phase, target, date),
    isRecoveryWeek: slot.isRecovery,
    volumeFactor: round2(curve[subphase] * slot.progression),
    focus: slot.isRecovery ? RECOVERY_FOCUS : FOCUS[slot.phase],
    subphase,
    cadence,
    raceInWeek: null,
    specificPrep: null,
    warnings,
  });
}
