/**
 * Compact "Plan → General" for the coach and Claude: one short row per week
 * (what the week is for, its phase, target minutes and focus) built with the
 * mirrored `buildSeason`, so both see the same weeks the athlete sees. A focus
 * equal to the previous week's is omitted to save tokens.
 */
import type { ISODate, Race, WeekPlan } from '../types.ts';
import { buildSeason } from './domain/season.ts';
import type { SeasonOverview, SeasonWeek, SeasonWeekKind } from './domain/season.ts';
import { athleteLevel } from './phase.ts';

export interface SeasonRow {
  weekStart: ISODate;
  kind: SeasonWeekKind;
  /** "Carga", "Más volumen", "Vuelta a la carga", "Descarga", "Semana libre", "Pico", "Afinamiento", "Carrera"… */
  label: string;
  /** "Base 2", "Construcción 1", "Mantenimiento"… */
  phaseLabel: string;
  targetMinutes: number;
  /** Omitted when it repeats the previous row's. */
  focus?: string;
  /** The week has a week plan (athlete, coach or Claude). */
  adjusted?: true;
  /** Taper, race and post-race weeks: a week plan does not change them. */
  fixed?: true;
  /** Race of that week. */
  race?: string;
}

export interface SeasonView {
  summary: string;
  warnings?: string[];
  weeks: SeasonRow[];
}

export interface SeasonInputs {
  today: ISODate;
  races: readonly Race[];
  level?: string | null;
  weeklyHoursTarget: number;
  weekPlans: readonly WeekPlan[];
  /** Weeks without a target race (default 8). */
  horizonWeeks?: number;
}

/** The season from the athlete's current week (mirrored domain/season.ts). */
export function seasonOf(input: SeasonInputs): SeasonOverview {
  return buildSeason({
    today: input.today,
    races: input.races,
    level: athleteLevel(input.level),
    weeklyHoursTarget: input.weeklyHoursTarget > 0 ? input.weeklyHoursTarget : 0,
    weekPlans: input.weekPlans,
    horizonWeeks: input.horizonWeeks,
  });
}

function rowOf(w: SeasonWeek, previousFocus: string | null): SeasonRow {
  return {
    weekStart: w.weekStart,
    kind: w.kind,
    label: w.label,
    phaseLabel: w.phaseLabel,
    targetMinutes: w.targetMinutes,
    ...(w.focus !== previousFocus ? { focus: w.focus } : {}),
    ...(w.plan ? { adjusted: true as const } : {}),
    ...(w.editable ? {} : { fixed: true as const }),
    ...(w.race ? { race: w.race.name } : {}),
  };
}

/** First `maxRows` weeks of the season as compact rows. */
export function seasonView(season: SeasonOverview, maxRows: number): SeasonView {
  const weeks = season.weeks.slice(0, Math.max(1, maxRows));
  return {
    summary: season.summary,
    ...(season.warnings.length > 0 ? { warnings: season.warnings } : {}),
    weeks: weeks.map((w, i) => rowOf(w, i > 0 ? weeks[i - 1].focus : null)),
  };
}
