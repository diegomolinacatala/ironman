/**
 * What a season week (Plan → General) holds without planning it: up to three
 * key sessions in coach words and the minutes per sport. Built from the same
 * pieces the weekly planner starts from — the week's phase with its override
 * (`applyWeekPlan`), its target minutes, the race-week sessions and the
 * allocation with the Z1-Z2 guard — but nothing is placed, so it stays cheap
 * enough for every row of the overview (≤ 52). Pure, no I/O.
 *
 * App-only: not mirrored to the edge functions.
 */
import { allocateSessions } from './allocation';
import { addDays, formatDuration } from './dates';
import { distanceKindOf, phaseFor, type PhaseInfo } from './periodization';
import { activeWeekPlan, enforceIntensityDistribution, pinnedRaceSessions } from './plannerSupport';
import { applyWeekPlan, type SeasonWeek } from './season';
import { buildSession, specClass, specIntensity, specSport, type SessionClass, type SessionCode, type SessionSpec } from './sessions';
import type { Profile, Race, WorkoutStep } from './types';
import { formatStepAmount, mainSet } from './zones';

export type SeasonSport = 'swim' | 'bike' | 'run' | 'brick' | 'strength';

export interface SeasonWeekDetail {
  /** Up to 3 key sessions, most important first ("Tirada larga 1h 30'", "Brick 1h 45' + 20'", "Carrera: Valencia"). */
  keySessions: string[];
  /** Planned minutes per sport; sports without time are left out and the race itself is not counted. */
  sportMinutes: Partial<Record<SeasonSport, number>>;
}

export interface SeasonDetailInput {
  profile: Profile;
  races: readonly Race[];
}

const MAX_KEY_SESSIONS = 3;
const SEASON_SPORTS: readonly SeasonSport[] = ['swim', 'bike', 'run', 'brick', 'strength'];

/** Inside the same priority: the race, then bricks, long sessions and quality sets. */
const CLASS_RANK: Partial<Record<SessionClass, number>> = { RACE: 0, BRICK: 1, LONG: 2, QUALITY: 3 };
const OTHER_RANK = 4;

const QUALITY_NAMES: Partial<Record<SessionCode, string>> = {
  BK_TEMPO: 'Tempo en bici',
  BK_SST: 'Sweet spot en bici',
  BK_THR: 'Series umbral en bici',
  BK_VO2: 'Series VO2 en bici',
  BK_RP: 'Ritmo de carrera en bici',
  RN_TEMPO: 'Tempo corriendo',
  RN_THR: 'Series umbral',
  RN_VO2: 'Series VO2',
  RN_HILLS: 'Cuestas',
  SW_CSS: 'Natación umbral',
  SW_SPEED: 'Natación velocidad',
};

/** The week's phase as the planner sees it: periodization plus the athlete's override. */
function weekPhase(week: SeasonWeek, input: SeasonDetailInput): { info: PhaseInfo; freeWeek: boolean } {
  const raw = phaseFor(week.weekStart, input.races, { level: input.profile.level });
  const plan = activeWeekPlan(raw, week.plan, week.weekStart);
  return { info: applyWeekPlan(raw, plan, input.profile.availability.weeklyHoursTarget), freeWeek: plan?.kind === 'rest' };
}

/** Race-week sessions plus the ideal sessions for the rest of the week's target minutes. */
function weekSpecs(week: SeasonWeek, input: SeasonDetailInput): SessionSpec[] {
  const { profile, races } = input;
  const { info, freeWeek } = weekPhase(week, input);
  const distance = info.targetRace?.distance ?? null;
  const kind = distanceKindOf(distance, profile.sports);
  const pinned = pinnedRaceSessions({
    info,
    next: phaseFor(addDays(week.weekStart, 7), races, { level: profile.level }),
    kind,
    firstPlannable: week.weekStart,
    weekEnd: addDays(week.weekStart, 6),
  });
  const pinnedMin = pinned.filter((s) => s.code !== 'RACE').reduce((sum, s) => sum + s.durationMin, 0);
  const ideal = allocateSessions({
    phase: info,
    distance,
    kind,
    minutes: Math.max(0, week.targetMinutes - pinnedMin),
    sports: profile.sports,
    qualityCut: 0,
    qualityCap: null,
    blockedAllWeek: [],
    substitutes: {},
    easyOnlyAllWeek: [],
    caps: { runLongMax: null, bikeLongMax: null },
    freeWeek,
  });
  return [...pinned, ...enforceIntensityDistribution(ideal, info.phase === 'race_week')];
}

function classRank(spec: SessionSpec): number {
  return CLASS_RANK[specClass(spec)] ?? OTHER_RANK;
}

/** Race, bricks, long and quality sessions (and the pre-race activation); never strength or mobility. */
function isKeyCandidate(spec: SessionSpec): boolean {
  const sport = specSport(spec);
  if (sport === 'strength' || sport === 'mobility') return false;
  return classRank(spec) < OTHER_RANK || spec.priority <= 2;
}

function byImportance(a: SessionSpec, b: SessionSpec): number {
  return a.priority - b.priority || classRank(a) - classRank(b) || b.durationMin - a.durationMin || a.code.localeCompare(b.code);
}

/** Minutes of the brick's run leg (steps tagged `leg: 'run'`, else its last step). */
function brickRunMinutes(spec: SessionSpec): number {
  const steps = buildSession(spec).steps;
  const runSteps = steps.some((s) => s.leg !== undefined) ? steps.filter((s) => s.leg === 'run') : steps.slice(-1);
  return runSteps.reduce((sum, s) => sum + (s.durationMin ?? 0) * (s.repeat ?? 1), 0);
}

function brickName(spec: SessionSpec): string {
  const run = Math.round(brickRunMinutes(spec));
  if (run <= 0 || run >= spec.durationMin) return `Brick ${formatDuration(spec.durationMin)}`;
  return `Brick ${formatDuration(spec.durationMin - run)} + ${formatDuration(run)}`;
}

/** Coach notation of a set: "4×10'", "6×75"" (short reps in seconds), "15×100 m", "1×10'". */
function setLabel(step: WorkoutStep): string {
  const min = step.durationMin;
  const amount = min !== undefined && min > 0 && min < 2 && !Number.isInteger(min) ? `${Math.round(min * 60)}"` : formatStepAmount(step);
  return amount ? `${step.repeat ?? 1}×${amount}` : '';
}

/** "Series umbral en bici 4×10'": the coach name plus the main set, else the session title. */
function qualityName(spec: SessionSpec): string {
  const content = buildSession(spec);
  const name = QUALITY_NAMES[spec.code];
  if (!name) return content.title;
  const set = mainSet(content.steps, specIntensity(spec));
  return `${name} ${(set && setLabel(set.step)) || formatDuration(spec.durationMin)}`;
}

function sessionName(spec: SessionSpec): string {
  const duration = formatDuration(spec.durationMin);
  switch (spec.code) {
    case 'RACE':
      return `Carrera: ${spec.raceName ?? 'día de carrera'}`;
    case 'BRICK':
      return brickName(spec);
    case 'BK_LONG':
      return `Bici larga ${duration}`;
    case 'RN_LONG':
      return `Tirada larga ${duration}`;
    case 'ACTIVATION':
      return `Activación ${duration}`;
    default:
      return qualityName(spec);
  }
}

/** The most important sessions, named once each (two identical hill sessions show as one). */
function keySessionsOf(specs: readonly SessionSpec[]): string[] {
  const names = specs.filter(isKeyCandidate).sort(byImportance).map(sessionName);
  return [...new Set(names)].slice(0, MAX_KEY_SESSIONS);
}

function sportMinutesOf(specs: readonly SessionSpec[]): Partial<Record<SeasonSport, number>> {
  const training = specs.filter((s) => specClass(s) !== 'RACE');
  return SEASON_SPORTS.reduce<Partial<Record<SeasonSport, number>>>((acc, sport) => {
    const minutes = training.filter((s) => specSport(s) === sport).reduce((sum, s) => sum + Math.round(s.durationMin), 0);
    return minutes > 0 ? { ...acc, [sport]: minutes } : acc;
  }, {});
}

/**
 * Key sessions and minutes per sport of a season week, from its phase (with
 * the week's override), `week.targetMinutes` and its race-week sessions.
 * Nothing is placed: it is the shape of the week, not the calendar.
 */
export function seasonWeekDetail(week: SeasonWeek, input: SeasonDetailInput): SeasonWeekDetail {
  const specs = weekSpecs(week, input);
  return { keySessions: keySessionsOf(specs), sportMinutes: sportMinutesOf(specs) };
}
