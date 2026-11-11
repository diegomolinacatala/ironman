/**
 * "Ajustar semana" (pure, unit-tested): the form state a week opens with, the
 * WeekPlan draft it saves and the hours the plan gives each option.
 */
import { phaseFor } from '@/domain/periodization';
import { WEEK_PLAN_OPTIONS, applyWeekPlan, type SeasonWeek } from '@/domain/season';
import { WEEK_PLAN_KINDS, type AthleteLevel, type ISODate, type Race, type WeekPlanDraft, type WeekPlanKind } from '@/domain/types';
import type { IconName } from '@/ui';

import { weekKindIcon } from './seasonModel';

export type HoursMode = 'auto' | 'custom';

export interface AdjustForm {
  kind: WeekPlanKind;
  /** 'auto' = weekly hours × the week's factor; 'custom' = `minutes`. */
  hoursMode: HoursMode;
  minutes: number;
  note: string;
}

/** What the plan needs to price each option (same inputs as `buildSeason`). */
export interface AdjustContext {
  races: readonly Race[];
  level?: AthleteLevel;
  weeklyHoursTarget: number;
}

export interface AdjustOption {
  kind: WeekPlanKind;
  label: string;
  help: string;
  icon: IconName;
}

/** WeekPlan contract limits. */
export const NOTE_MAX = 300;
export const MINUTES_MAX = 3000;
export const MINUTES_STEP = 15;

export const ADJUST_OPTIONS: readonly AdjustOption[] = WEEK_PLAN_KINDS.map((kind) => ({
  kind,
  label: WEEK_PLAN_OPTIONS[kind].label,
  help: WEEK_PLAN_OPTIONS[kind].help,
  icon: weekKindIcon(kind),
}));

function isPlanKind(kind: string): kind is WeekPlanKind {
  return (WEEK_PLAN_KINDS as readonly string[]).includes(kind);
}

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_MAX, Math.max(0, Math.round(minutes)));
}

/** Nearest stepper value (multiple of 15'). */
export function stepMinutes(minutes: number): number {
  return clampMinutes(Math.round(minutes / MINUTES_STEP) * MINUTES_STEP);
}

/** The week's override when it has one; else its current kind (a normal load week for taper/race…). */
export function initialAdjustForm(week: SeasonWeek): AdjustForm {
  const plan = week.plan;
  if (plan) {
    return {
      kind: plan.kind,
      hoursMode: plan.targetMinutes == null ? 'auto' : 'custom',
      minutes: clampMinutes(plan.targetMinutes ?? week.targetMinutes),
      note: plan.note ?? '',
    };
  }
  return { kind: isPlanKind(week.kind) ? week.kind : 'load', hoursMode: 'auto', minutes: stepMinutes(week.targetMinutes), note: '' };
}

export function toWeekPlanDraft(form: AdjustForm, weekStart: ISODate): WeekPlanDraft {
  const note = form.note.trim().slice(0, NOTE_MAX);
  return {
    weekStart,
    kind: form.kind,
    targetMinutes: form.hoursMode === 'custom' ? clampMinutes(form.minutes) : null,
    note: note.length > 0 ? note : null,
    source: 'manual',
  };
}

/** Target minutes the plan gives the week with this option and no explicit hours (as `buildSeason`). */
export function autoMinutes(weekStart: ISODate, kind: WeekPlanKind, ctx: AdjustContext): number {
  const raw = phaseFor(weekStart, ctx.races, { level: ctx.level });
  const info = applyWeekPlan(raw, { weekStart, kind, targetMinutes: null }, ctx.weeklyHoursTarget);
  return Math.max(0, Math.round((ctx.weeklyHoursTarget * 60 * info.volumeFactor) / 5) * 5);
}
