/**
 * The coach's week-level plan ("Plan general") → card rows and the drafts to
 * save. Pure. Nothing is saved without the athlete's tap, and weeks the server
 * would reject (not a Monday, before this week, more than a year ahead) are
 * left out instead of failing the whole save.
 */
import { addDays, formatDayMedium, isISODate, startOfWeek } from '@/domain/dates';
import { WEEK_PLAN_OPTIONS } from '@/domain/season';
import { WEEK_PLAN_KINDS, type CoachResponse, type ISODate, type WeekPlanDraft, type WeekPlanKind, type WeekPlanSource } from '@/domain/types';
import { formatHours } from '@/features/progress/format';
import { SEASON_HREF } from '@/features/season/links';

/** Where the saved plan is shown (Plan › General). */
export const GENERAL_PLAN_HREF = SEASON_HREF;

const MAX_MINUTES = 3000;
const MAX_NOTE = 300;
const MAX_WEEKS_AHEAD = 52;

export interface WeekPlanRow {
  weekStart: ISODate;
  /** "Lun 16 nov · Descarga · 5 h". */
  label: string;
  note: string | null;
}

export interface WeekPlanSuggestion {
  rows: WeekPlanRow[];
  /** What "Guardar en tu plan general" saves (source added on save). */
  drafts: WeekPlanDraft[];
}

function capitalize(text: string): string {
  return text.length > 0 ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function isKind(value: unknown): value is WeekPlanKind {
  return typeof value === 'string' && (WEEK_PLAN_KINDS as readonly string[]).includes(value);
}

function minutesOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_MINUTES, Math.max(0, Math.round(value)));
}

function noteOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  return clean || null;
}

/** A Monday from this week to a year ahead. */
function isPlannableWeek(weekStart: unknown, thisMonday: ISODate): weekStart is ISODate {
  if (!isISODate(weekStart) || startOfWeek(weekStart) !== weekStart) return false;
  return weekStart >= thisMonday && weekStart <= addDays(thisMonday, MAX_WEEKS_AHEAD * 7);
}

function normalize(draft: WeekPlanDraft, thisMonday: ISODate): WeekPlanDraft | null {
  if (!isPlannableWeek(draft.weekStart, thisMonday) || !isKind(draft.kind)) return null;
  return { weekStart: draft.weekStart, kind: draft.kind, targetMinutes: minutesOf(draft.targetMinutes), note: noteOf(draft.note) };
}

/** "Lun 16 nov · Descarga · 5 h" (no hours when the coach gave none). */
export function weekPlanLabel(draft: WeekPlanDraft): string {
  const day = capitalize(formatDayMedium(draft.weekStart).replace(/\./g, ''));
  const minutes = draft.targetMinutes ?? 0;
  return [day, WEEK_PLAN_OPTIONS[draft.kind].label, minutes > 0 ? formatHours(minutes) : ''].filter(Boolean).join(' · ');
}

/** Valid, de-duplicated (first wins) weeks of the coach's suggestion in date order. */
export function weekPlanSuggestion(weekPlans: readonly WeekPlanDraft[] | null | undefined, today: ISODate): WeekPlanSuggestion {
  const thisMonday = startOfWeek(today);
  const byWeek = new Map<ISODate, WeekPlanDraft>();
  for (const draft of weekPlans ?? []) {
    const clean = normalize(draft, thisMonday);
    if (clean && !byWeek.has(clean.weekStart)) byWeek.set(clean.weekStart, clean);
  }
  const drafts = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return { drafts, rows: drafts.map((d) => ({ weekStart: d.weekStart, label: weekPlanLabel(d), note: d.note ?? null })) };
}

/** Who suggested the weeks: the AI coach, or the rules engine (saved as the athlete's own). */
export function weekPlanSource(engine: CoachResponse['engine']): WeekPlanSource {
  return engine === 'ai' ? 'ai_coach' : 'manual';
}

/** "Plan general · 3 semanas". */
export function weekPlansHeading(count: number): string {
  return `Plan general · ${count === 1 ? '1 semana' : `${count} semanas`}`;
}
