/**
 * The training week as the app shows it: an adapter over the mirrored app
 * periodization (domain/periodization.ts `phaseFor`) with the athlete's
 * week-level plan applied (domain/season.ts `applyWeekPlan`), labelled like
 * Plan → General labels it (`buildSeason`). The AI coach, Claude and the
 * briefing therefore see the same phase, volume and "Carga / Descarga" week
 * the athlete sees. Keeps the older server fields (label, focus,
 * suggestRecoveryWeek…) for existing consumers.
 */
import { diffDays, startOfWeek } from '../dates.ts';
import type { AthleteLevel, ISODate, Race, WeekPlan } from '../types.ts';
import type { Subphase } from './domain/constants.ts';
import { phaseFor as domainPhaseFor } from './domain/periodization.ts';
import type { Phase } from './domain/periodization.ts';
import { applyWeekPlan, buildSeason, canOverride } from './domain/season.ts';
import type { SeasonOverview, SeasonWeek, SeasonWeekKind } from './domain/season.ts';

export { nextRace } from './domain/periodization.ts';
export type { Phase };

export type RaceRef = Pick<Race, 'id' | 'name' | 'date' | 'distance' | 'priority'>;

export interface PhaseInfo {
  phase: Phase;
  /** "Base 2", "Construcción 1", "Mantenimiento", "Afinamiento"… (Plan → General's phase label). */
  label: string;
  /** What the week works on (periodization focus, or the week plan's, with its note). */
  focus: string;
  targetRace: RaceRef | null;
  daysToRace: number | null;
  weeksToRace: number | null;
  /** Older consumers: same as `isRecoveryWeek`. */
  suggestRecoveryWeek: boolean;
  isRecoveryWeek: boolean;
  /** Multiplier over the athlete's weekly hours target (week plan applied). */
  volumeFactor: number;
  subphase: Subphase | null;
  /** load, push, recovery, rest, taper, race or transition. */
  weekKind: SeasonWeekKind;
  /** "Carga", "Más volumen", "Vuelta a la carga", "Descarga", "Semana libre", "Pico", "Afinamiento", "Carrera"… */
  weekLabel: string;
  /** Target training minutes of the week (multiple of 5), null without a weekly hours target. */
  targetMinutes: number | null;
  /** The week has a week-level plan (set in Plan → General by the athlete, the coach or Claude). */
  adjusted: boolean;
  /** Race this week (the target or a B/C race), else null. */
  raceInWeek: RaceRef | null;
  /** Spanish periodization warnings (plan too short, A races too close…). */
  warnings: string[];
}

export interface PhaseOptions {
  /** `profile.level`; unknown values use the default 3:1 cadence. */
  level?: string | null;
  /** The athlete's normal weekly hours (week plans in minutes and targetMinutes need it). */
  weeklyHoursTarget?: number | null;
  /** Week-level plans ("Plan → General"). */
  weekPlans?: readonly WeekPlan[];
  /** The athlete's today: weeks from this one on are labelled like the app's season view. */
  today?: ISODate;
  /** Season already built from `today` (avoids building it twice). */
  season?: SeasonOverview;
}

const LEVELS: readonly AthleteLevel[] = ['beginner', 'intermediate', 'advanced'];
const MAX_SEASON_WEEKS = 52;

const PHASE_LABELS: Readonly<Record<Phase, string>> = {
  prep: 'Preparación',
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Afinamiento',
  race_week: 'Semana de carrera',
  recovery: 'Recuperación',
  transition: 'Transición',
};

export function athleteLevel(level: string | null | undefined): AthleteLevel | undefined {
  return LEVELS.find((l) => l === level);
}

function hoursOf(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function raceRef(race: Race | null): RaceRef | null {
  return race ? { id: race.id, name: race.name, date: race.date, distance: race.distance, priority: race.priority } : null;
}

/** The season row of `monday` as Plan → General shows it (from the athlete's today), else the week on its own. */
function seasonWeekOf(monday: ISODate, races: readonly Race[], opts: PhaseOptions): SeasonWeek | null {
  const known = opts.season?.weeks.find((w) => w.weekStart === monday);
  if (known) return known;
  const input = { races, level: athleteLevel(opts.level), weeklyHoursTarget: hoursOf(opts.weeklyHoursTarget), weekPlans: opts.weekPlans ?? [] };
  const current = opts.today ? startOfWeek(opts.today) : monday;
  const ahead = diffDays(monday, current) / 7;
  if (ahead > 0 && ahead < MAX_SEASON_WEEKS) {
    const row = buildSeason({ ...input, today: current, horizonWeeks: ahead + 1 }).weeks.find((w) => w.weekStart === monday);
    if (row) return row;
  }
  return buildSeason({ ...input, today: monday, horizonWeeks: 1 }).weeks[0] ?? null;
}

/**
 * Phase, volume and week type of the week containing `date`, with the
 * athlete's week plan applied. `date` keeps its meaning for days to the race
 * (the briefing passes the day, the planning context the Monday).
 */
export function phaseFor(date: ISODate, races: readonly Race[], opts: PhaseOptions = {}): PhaseInfo {
  const monday = startOfWeek(date);
  const raw = domainPhaseFor(date, races, { level: athleteLevel(opts.level) });
  const plan = canOverride(raw) ? ((opts.weekPlans ?? []).find((p) => p.weekStart === monday) ?? null) : null;
  const hours = hoursOf(opts.weeklyHoursTarget);
  const info = applyWeekPlan(raw, plan, hours);
  const week = seasonWeekOf(monday, races, opts);
  return {
    phase: info.phase,
    label: week?.phaseLabel ?? PHASE_LABELS[info.phase],
    focus: info.focus,
    targetRace: raceRef(info.targetRace),
    daysToRace: info.daysToRace,
    weeksToRace: info.weeksToRace,
    suggestRecoveryWeek: info.isRecoveryWeek,
    isRecoveryWeek: info.isRecoveryWeek,
    volumeFactor: info.volumeFactor,
    subphase: info.subphase,
    weekKind: week?.kind ?? (info.isRecoveryWeek ? 'recovery' : 'load'),
    weekLabel: week?.label ?? (info.isRecoveryWeek ? 'Descarga' : 'Carga'),
    targetMinutes: hours > 0 ? Math.max(0, Math.round((hours * 60 * info.volumeFactor) / 5) * 5) : null,
    adjusted: plan !== null,
    raceInWeek: raceRef(info.raceInWeek),
    warnings: info.warnings,
  };
}
