/**
 * Season overview ("Plan → General"): the weeks from now to the target race at
 * a glance — what each week is for (carga, más volumen, descarga, afinamiento,
 * carrera…), its target hours and the coach's why — without planning
 * individual workouts. Built from `phaseFor` per Monday plus the week-level
 * overrides (`WeekPlan`) set by the athlete, the coach or Claude; the weekly
 * planner honours the same overrides through `applyWeekPlan`.
 *
 * Overrides only apply to prep/base/build weeks without a race: taper, race,
 * transition and post-race weeks always follow the periodization.
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs (a test fails when they drift): import only
 * constants, dates, periodization and types here.
 */
import {
  BLOCK_PROGRESSION_21,
  BLOCK_PROGRESSION_31,
  RECOVERY_FACTOR_21,
  RECOVERY_FACTOR_31,
  TRANSITION_FACTOR,
  VOLUME_CURVE,
  type Subphase,
} from './constants';
import { addDays, diffDays, startOfWeek } from './dates';
import { distanceKindOf, phaseFor, type Phase, type PhaseInfo } from './periodization';
import type { AthleteLevel, ISODate, Race, WeekPlan, WeekPlanDraft, WeekPlanKind } from './types';

/** What a week is for, in coach words. */
export type SeasonWeekKind = WeekPlanKind | 'taper' | 'race' | 'transition';

export interface SeasonWeek {
  /** Monday. */
  weekStart: ISODate;
  /** 1-based position in the overview. */
  number: number;
  kind: SeasonWeekKind;
  /** "Carga", "Más volumen", "Vuelta a la carga", "Descarga", "Semana libre", "Pico", "Afinamiento", "Carrera"… */
  label: string;
  phase: Phase;
  /** "Base 2", "Construcción 1", "Mantenimiento"… */
  phaseLabel: string;
  /** What the week works on (periodization focus, or the override's). */
  focus: string;
  /** Why the week looks like this. */
  why: string;
  volumeFactor: number;
  /** Target training minutes (multiple of 5). */
  targetMinutes: number;
  /** Change vs the previous week (0.1 = +10 %); null for the first week. */
  trend: number | null;
  /** Race this week (target race, or a B/C race), else null. */
  race: Race | null;
  /** Override applied to this week, if any. */
  plan: WeekPlan | null;
  /** Whether a WeekPlan may change this week. */
  editable: boolean;
  isCurrent: boolean;
}

export interface SeasonOverview {
  targetRace: Race | null;
  weeks: SeasonWeek[];
  /** Distinct periodization warnings (plan too short, races too close…). */
  warnings: string[];
  /** One sentence ("Hasta Valencia: 2 semanas de carga, 1 de afinamiento y la de carrera."). */
  summary: string;
}

export interface SeasonInput {
  today: ISODate;
  races: readonly Race[];
  level?: AthleteLevel;
  /** The athlete's weekly hours target (a normal week). */
  weeklyHoursTarget: number;
  weekPlans?: readonly WeekPlan[];
  /** Weeks to show without a target race (default 8). */
  horizonWeeks?: number;
}

/** Labels and help for the override picker. */
export const WEEK_PLAN_OPTIONS: Readonly<Record<WeekPlanKind, { label: string; help: string }>> = {
  load: { label: 'Carga', help: 'Semana normal de entrenamiento.' },
  push: { label: 'Más volumen', help: 'Un 10 % más que una semana de carga.' },
  recovery: { label: 'Descarga', help: 'Alrededor de un 40 % menos para asimilar el trabajo.' },
  rest: { label: 'Semana libre', help: 'Vacaciones, exámenes o viaje: casi sin plan.' },
};

const MAX_WEEKS = 52;
const DEFAULT_HORIZON = 8;
const PUSH_FACTOR = 1.1;
const MAX_FACTOR = 1.6;

const SUBPHASE_LABEL: Readonly<Record<Subphase, string>> = {
  prep: 'Preparación',
  base1: 'Base 1',
  base2: 'Base 2',
  base3: 'Base 3',
  build1: 'Construcción 1',
  build2: 'Construcción 2',
  maintenance: 'Mantenimiento',
};

const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  prep: 'Preparación',
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Afinamiento',
  race_week: 'Semana de carrera',
  recovery: 'Recuperación',
  transition: 'Transición',
};

const LOAD_WHY: Readonly<Record<Subphase, string>> = {
  prep: 'Vuelta a la rutina: fondo suave, técnica y fuerza general.',
  base1: 'Base: volumen en zona 2 y técnica; la intensidad, mínima.',
  base2: 'Base: más horas en zona 2 y aparece el tempo.',
  base3: 'Base: el volumen más alto de la base, con algo de umbral.',
  build1: 'Construcción: ritmo de carrera, series al umbral y bricks. Son las semanas que más pesan.',
  build2: 'Construcción: lo más específico del plan, al ritmo de tu carrera.',
  maintenance: 'Sin carrera a la vista: mantienes la forma con descargas cada pocas semanas.',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round5(n: number): number {
  return Math.max(0, Math.round(n / 5) * 5);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Whether a WeekPlan may change this week: prep/base/build weeks without a race. */
export function canOverride(info: PhaseInfo): boolean {
  return (info.phase === 'prep' || info.phase === 'base' || info.phase === 'build') && info.raceInWeek === null;
}

/** Volume factor the week would have as a normal load week. */
function loadFactorOf(info: PhaseInfo): number {
  if (!info.isRecoveryWeek) return info.volumeFactor;
  const distance = info.targetRace?.distance ?? null;
  const curve = VOLUME_CURVE[distance === 'full' ? 'full' : distanceKindOf(distance)];
  const subphase = info.subphase ?? 'maintenance';
  if (subphase !== 'maintenance' || !info.targetRace) return curve[subphase];
  const firstLoad = (info.cadence === '3:1' ? BLOCK_PROGRESSION_31 : BLOCK_PROGRESSION_21)[0];
  return Math.min(curve.maintenance, curve.base1 * firstLoad);
}

function overrideOf(info: PhaseInfo, kind: WeekPlanKind): Pick<PhaseInfo, 'isRecoveryWeek' | 'volumeFactor' | 'focus'> {
  const load = loadFactorOf(info);
  const recovery = info.cadence === '3:1' ? RECOVERY_FACTOR_31 : RECOVERY_FACTOR_21;
  switch (kind) {
    case 'load':
      return {
        isRecoveryWeek: false,
        volumeFactor: load,
        focus: info.isRecoveryWeek ? 'Semana de carga en lugar de descarga: sigue construyendo, pero vigila el cansancio.' : info.focus,
      };
    case 'push':
      return { isRecoveryWeek: false, volumeFactor: load * PUSH_FACTOR, focus: 'Semana de más volumen: subimos un 10 % y mantenemos la intensidad.' };
    case 'recovery':
      return { isRecoveryWeek: true, volumeFactor: load * recovery, focus: 'Semana de descarga: asimilamos el trabajo.' };
    case 'rest':
      return { isRecoveryWeek: true, volumeFactor: TRANSITION_FACTOR, focus: 'Semana libre: actividad suave, sin estructura.' };
  }
}

/**
 * The week's phase info with the athlete's override applied (volume, descarga
 * flag, focus). Unchanged without a plan or when the week cannot be overridden.
 */
export function applyWeekPlan(info: PhaseInfo, plan: WeekPlan | WeekPlanDraft | null | undefined, weeklyHoursTarget: number): PhaseInfo {
  if (!plan || !canOverride(info)) return info;
  const next = overrideOf(info, plan.kind);
  const minutes = plan.targetMinutes;
  const factor = typeof minutes === 'number' && Number.isFinite(minutes) && weeklyHoursTarget > 0 ? minutes / (weeklyHoursTarget * 60) : next.volumeFactor;
  const note = plan.note?.trim();
  return {
    ...info,
    ...next,
    volumeFactor: round2(clamp(factor, 0, MAX_FACTOR)),
    focus: note ? `${next.focus} ${note}` : next.focus,
  };
}

function kindOf(info: PhaseInfo, plan: WeekPlan | null): SeasonWeekKind {
  if (plan && canOverride(info)) return plan.kind;
  if (info.phase === 'race_week' || info.raceInWeek !== null) return 'race';
  if (info.phase === 'taper' || info.phase === 'peak') return 'taper';
  if (info.phase === 'transition') return 'transition';
  if (info.phase === 'recovery' || info.isRecoveryWeek) return 'recovery';
  return 'load';
}

function raceLabel(info: PhaseInfo): string {
  const race = info.raceInWeek;
  return race && race.id !== info.targetRace?.id ? `Carrera ${race.priority}` : 'Carrera';
}

function labelOf(kind: SeasonWeekKind, info: PhaseInfo, trend: number | null, prev: SeasonWeekKind | null): string {
  switch (kind) {
    case 'race':
      return raceLabel(info);
    case 'taper':
      return info.phase === 'peak' ? 'Pico' : 'Afinamiento';
    case 'transition':
      return 'Transición';
    case 'recovery':
      return info.phase === 'recovery' ? 'Recuperación' : 'Descarga';
    case 'rest':
      return 'Semana libre';
    case 'push':
      return 'Más volumen';
    case 'load':
      if (prev === 'recovery' || prev === 'rest' || prev === 'transition') return 'Vuelta a la carga';
      return trend !== null && trend >= 0.04 ? 'Más volumen' : 'Carga';
  }
}

function raceWhy(info: PhaseInfo): string {
  const race = info.raceInWeek ?? info.targetRace;
  if (race && race.id !== info.targetRace?.id && race.priority === 'B') return 'Carrera B: mini-afinamiento de 3–5 días para llegar fresco sin perder el hilo del plan.';
  if (race && race.id !== info.targetRace?.id) return 'Carrera C: es un entrenamiento de calidad; el día antes, suave.';
  return 'Activaciones cortas, descanso y confianza: el trabajo ya está hecho.';
}

function whyOf(kind: SeasonWeekKind, info: PhaseInfo): string {
  switch (kind) {
    case 'race':
      return raceWhy(info);
    case 'taper':
      return 'Bajamos volumen y mantenemos la intensidad para llegar fresco a la carrera.';
    case 'transition':
      return 'Después de la carrera: recupera cuerpo y cabeza antes de volver a construir.';
    case 'recovery':
      return info.phase === 'recovery'
        ? 'Tras la carrera: unos días suaves antes de retomar.'
        : 'Bajamos alrededor de un 40 % el volumen para asimilar lo trabajado: vuelves más fuerte a la carga.';
    case 'rest':
      return 'Semana libre: muévete si te apetece, sin plan. Volvemos con energía.';
    case 'push':
      return 'Subimos un 10 % para estimular más adaptación; si el cuerpo protesta, vuelve a la carga normal.';
    case 'load': {
      const subphase = info.subphase ?? 'maintenance';
      if (subphase === 'maintenance' && info.targetRace) return 'Base de mantenimiento: sostienes la forma hasta que empiece el plan hacia tu carrera.';
      return LOAD_WHY[subphase];
    }
  }
}

function weekCount(current: ISODate, target: Race | null, horizon: number | undefined): number {
  if (!target) return clamp(Math.round(horizon ?? DEFAULT_HORIZON), 1, MAX_WEEKS);
  const weeks = Math.round(diffDays(startOfWeek(target.date), current) / 7) + 1;
  return clamp(weeks, 1, MAX_WEEKS);
}

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function countOf(weeks: readonly SeasonWeek[], kinds: readonly SeasonWeekKind[]): number {
  return weeks.filter((w) => kinds.includes(w.kind)).length;
}

function summaryOf(weeks: readonly SeasonWeek[], target: Race | null): string {
  if (weeks.length === 0) return '';
  const lastIsTargetRace = target !== null && weeks[weeks.length - 1]?.race?.id === target.id;
  const otherRaces = countOf(weeks, ['race']) - (lastIsTargetRace ? 1 : 0);
  const rest = countOf(weeks, ['rest']);
  const counts: [number, string][] = [
    [countOf(weeks, ['load', 'push']), 'de carga'],
    [countOf(weeks, ['recovery']), 'de descarga'],
    [rest, rest === 1 ? 'libre' : 'libres'],
    [countOf(weeks, ['taper']), 'de afinamiento'],
    [countOf(weeks, ['transition']), 'de transición'],
    [otherRaces, 'con otra carrera'],
  ];
  const parts = counts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  if (lastIsTargetRace) parts.push('la de carrera');
  if (!target) return `Sin carrera a la vista. Próximas ${weeks.length} semana${weeks.length === 1 ? '' : 's'}: ${joinEs(parts)}.`;
  // No total here: the hero already says how many weeks are left (race week excluded), and two
  // different counts in one card read as a contradiction.
  const [first, ...others] = parts;
  if (!first || first === 'la de carrera') return `Esta es tu semana de carrera: ${target.name}.`;
  const lead = first.replace(/^(\d+) /, (_m, n: string) => `${n} semana${n === '1' ? '' : 's'} `);
  return `Hasta ${target.name}: ${joinEs([lead, ...others])}.`;
}

/** Week-by-week overview from this week to the target race (or the next `horizonWeeks`). */
export function buildSeason(input: SeasonInput): SeasonOverview {
  const current = startOfWeek(input.today);
  const plans = new Map((input.weekPlans ?? []).map((p) => [p.weekStart, p] as const));
  const first = phaseFor(current, input.races, { level: input.level });
  const target = first.targetRace;
  const count = weekCount(current, target, input.horizonWeeks);
  const weeks: SeasonWeek[] = [];
  const warnings = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const weekStart = addDays(current, i * 7);
    const raw = i === 0 ? first : phaseFor(weekStart, input.races, { level: input.level });
    raw.warnings.forEach((w) => warnings.add(w));
    const editable = canOverride(raw);
    const plan = editable ? (plans.get(weekStart) ?? null) : null;
    const info = applyWeekPlan(raw, plan, input.weeklyHoursTarget);
    const targetMinutes = round5(input.weeklyHoursTarget * 60 * info.volumeFactor);
    const prev = weeks[weeks.length - 1] ?? null;
    const trend = prev && prev.targetMinutes > 0 ? round2((targetMinutes - prev.targetMinutes) / prev.targetMinutes) : null;
    const kind = kindOf(raw, plan);
    weeks.push({
      weekStart,
      number: i + 1,
      kind,
      label: labelOf(kind, raw, trend, prev?.kind ?? null),
      phase: raw.phase,
      phaseLabel: raw.subphase ? SUBPHASE_LABEL[raw.subphase] : PHASE_LABEL[raw.phase],
      focus: info.focus,
      why: whyOf(kind, raw),
      volumeFactor: info.volumeFactor,
      targetMinutes,
      trend,
      race: raw.phase === 'race_week' ? (raw.raceInWeek ?? raw.targetRace) : raw.raceInWeek,
      plan,
      editable,
      isCurrent: i === 0,
    });
  }
  return { targetRace: target, weeks, warnings: [...warnings], summary: summaryOf(weeks, target) };
}
