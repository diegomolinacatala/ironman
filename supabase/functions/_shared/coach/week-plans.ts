/**
 * The general plan the coach suggests in a chat (`week_plans` in its structured
 * output: "esta semana descarga, la siguiente más volumen…"). Only a
 * suggestion: it goes to `coach_jobs.extras.weekPlans` and the app saves it
 * when the athlete taps "Guardar en tu plan general". Lenient: invalid weeks
 * are dropped (and logged), texts clipped; never fails the job. Pure.
 */
import { checkWeekPlans, COACH_WEEK_PLAN_WEEKS, WEEK_PLAN_LIMITS } from '../planning/week-plans.ts';
import type { RawWeekPlan } from '../planning/week-plans.ts';
import type { ISODate, Race, WeekPlanDraft } from '../types.ts';
import { clipText } from './prescription.ts';

export interface CoachWeekPlansCheck {
  today: ISODate;
  races: readonly Race[];
  level?: string | null;
}

export interface CoachWeekPlans {
  weekPlans: WeekPlanDraft[];
  dropped: string[];
}

function rawWeek(item: unknown): RawWeekPlan | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const w = item as Record<string, unknown>;
  return {
    week_start: typeof w.week_start === 'string' ? w.week_start.trim() : w.week_start,
    kind: w.kind,
    target_minutes: typeof w.target_minutes === 'number' ? w.target_minutes : null,
    note: clipText(w.note, WEEK_PLAN_LIMITS.noteMax),
  };
}

/** Valid suggested weeks (Monday from this week to +26, editable, sorted); the rest are reported. */
export function toCoachWeekPlans(raw: unknown, check: CoachWeekPlansCheck): CoachWeekPlans {
  if (raw === null || raw === undefined) return { weekPlans: [], dropped: [] };
  if (!Array.isArray(raw)) return { weekPlans: [], dropped: ['week_plans no es una lista'] };
  const weeks = raw.map(rawWeek);
  const usable = weeks.filter((w): w is RawWeekPlan => w !== null);
  const result = checkWeekPlans(usable.slice(0, COACH_WEEK_PLAN_WEEKS + 1), {
    today: check.today,
    maxWeeks: COACH_WEEK_PLAN_WEEKS,
    races: check.races,
    level: check.level,
    source: 'ai_coach',
  });
  const notObjects = weeks.length - usable.length;
  return {
    weekPlans: [...result.valid].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    dropped: [...result.issues, ...(notObjects > 0 ? [`${notObjects} semana(s) sin formato válido`] : [])],
  };
}
