/**
 * Macrocycle periodization counted backwards from the target race
 * (docs/research/02 §5): race week → taper/peak → build → base → prep,
 * with 3:1 (or 2:1) recovery cadence and per-distance taper factors.
 *
 * Plan length: from the previous A race's transition, else from the week the
 * A race was added (`race.createdAt`), so the layout is stable week to week.
 * Shorter than the minimum viable length → "survival" plan (base + taper) and
 * a PLAN_TOO_SHORT warning. Recovery weeks close each base/build subphase
 * (recoveryLayout.ts).
 */
import {
  BLOCK_PROGRESSION_21,
  BLOCK_PROGRESSION_31,
  B_RACE_WEEK_FACTOR,
  C_RACE_WEEK_FACTOR,
  PHASE_TABLE,
  POST_B_RECOVERY_FACTOR,
  RECOVERY_FACTOR_21,
  RECOVERY_FACTOR_31,
  TAPER_FACTORS,
  TRANSITION_FACTOR,
  VOLUME_CURVE,
  type DistanceKind,
  type Subphase,
} from './constants';
import { addDays, diffDays, isISODate, isoWeekNumber, startOfWeek, weekRange } from './dates';
import { loadWeeks, type RecoveryCadence } from './recoveryLayout';
import type { AthleteLevel, ISODate, Race, RaceDistance, TrainableSport } from './types';

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
  /** Spanish warnings (races too close…). */
  warnings: string[];
}

export interface PhaseOptions {
  level?: AthleteLevel;
  /** High life stress recently → 2:1 cadence. */
  lifeStress?: boolean;
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

/** Below the minimum viable length: race week + 1 taper week + base (no build). §5.2 */
function survival(distance: RaceDistance, available: number): Allocation {
  const taperWeeks = available >= 2 ? 1 : 0;
  const base = Math.max(0, available - 1 - taperWeeks);
  return { prep: 0, base, build: 0, taperWeeks, warnings: [tooShortWarning(distance, PHASE_TABLE[distance].minViable)] };
}

/** Doc §5.2 allocation; `available` = weeks from plan start to race week inclusive (null = open). */
function allocate(distance: RaceDistance, available: number | null, withTaper: boolean): Allocation {
  const D = PHASE_TABLE[distance];
  const taperWeeks = withTaper ? (TAPER_FACTORS[distance].minus2 !== null ? 2 : 1) : 0;
  if (available === null) return { prep: 0, base: D.base.max, build: D.build.ideal, taperWeeks, warnings: [] };
  if (withTaper && available < D.minViable) return survival(distance, available);
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
 * Maintenance load/recovery cycle. Before a planned macrocycle it is counted
 * back from the plan start (`weeksBeforePlan` = 0 is the week right before it),
 * which is always a recovery week, so the cadence never runs on across the
 * boundary; otherwise it follows the ISO week number.
 */
function maintenanceCycle(date: ISODate, cadence: RecoveryCadence, weeksBeforePlan: number | null): CycleInfo {
  if (weeksBeforePlan === null) return cycleAt(isoWeekNumber(date), cadence);
  const cycle = cadence === '3:1' ? 4 : 3;
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
    warnings,
  };
}

function recentRaceState(sorted: Race[], date: ISODate): { race: Race; kind: 'transition' | 'recovery' } | null {
  const past = sorted.filter((r) => r.date < date && r.priority !== 'C');
  const last = past[past.length - 1];
  if (!last) return null;
  const days = diffDays(date, last.date);
  const window = PHASE_TABLE[last.distance].transitionDays;
  if (last.priority === 'A' && days <= window) return { race: last, kind: 'transition' };
  if (last.priority === 'B' && days <= Math.ceil(window / 2)) return { race: last, kind: 'recovery' };
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

function raceWeekAdjust(info: PhaseInfo, race: Race | null): PhaseInfo {
  if (!race || race.id === info.targetRace?.id || info.phase === 'race_week') return { ...info, raceInWeek: race ?? info.raceInWeek };
  if (race.priority === 'A') return { ...info, raceInWeek: race };
  const factor = race.priority === 'B' ? B_RACE_WEEK_FACTOR : C_RACE_WEEK_FACTOR;
  const note = race.priority === 'B' ? ' Carrera B esta semana: mini-taper de 3-5 días.' : ' Carrera C esta semana: el día antes, suave.';
  return { ...info, raceInWeek: race, volumeFactor: round2(info.volumeFactor * factor), focus: `${info.focus}${note}` };
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
    warnings: [],
  };
}

/** Training phase, volume factor and focus for the week containing `date`. */
export function phaseFor(date: ISODate, races: readonly Race[], opts: PhaseOptions = {}): PhaseInfo {
  const sorted = sortRaces(races);
  const cadence = cadenceFor(opts);
  const target = nextRace(sorted, date);
  const weekStart = startOfWeek(date);
  const recent = recentRaceState(sorted, date);
  const k = target ? Math.round(diffDays(startOfWeek(target.date), weekStart) / 7) : null;
  if (recent && (k === null || k > 1)) return postRaceInfo(recent, target, date, cadence);
  if (!target || k === null) return maintenanceInfo(date, null, cadence, []);

  const avail = availableWeeks(sorted, target);
  const alloc = allocate(target.distance, avail.weeks, target.priority === 'A');
  const slots = layout(target.distance, alloc, cadence);
  const warnings = [...avail.warnings, ...alloc.warnings];
  const slot = slots[k];
  if (!slot) return raceWeekAdjust(maintenanceInfo(date, target, cadence, warnings, k - slots.length), raceInWeekOf(sorted, date));

  const curve = curveFor(target.distance);
  const buildAvg = (curve.build1 + curve.build2) / 2;
  let info: PhaseInfo;
  if (slot.taper !== null) {
    const isBRaceWeek = slot.phase === 'race_week' && target.priority !== 'A';
    const factor = isBRaceWeek ? curve.build2 * (target.priority === 'B' ? B_RACE_WEEK_FACTOR : C_RACE_WEEK_FACTOR) : buildAvg * slot.taper;
    info = {
      ...baseInfo(slot.phase, target, date),
      isRecoveryWeek: false,
      volumeFactor: round2(factor),
      focus: FOCUS[slot.phase],
      subphase: null,
      cadence,
      raceInWeek: null,
      warnings,
    };
  } else {
    const subphase = slot.subphase ?? 'maintenance';
    info = {
      ...baseInfo(slot.phase, target, date),
      isRecoveryWeek: slot.isRecovery,
      volumeFactor: round2(curve[subphase] * slot.progression),
      focus: slot.isRecovery ? RECOVERY_FOCUS : FOCUS[slot.phase],
      subphase,
      cadence,
      raceInWeek: null,
      warnings,
    };
  }
  return raceWeekAdjust(info, raceInWeekOf(sorted, date));
}
