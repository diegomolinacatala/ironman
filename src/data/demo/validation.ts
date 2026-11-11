/**
 * Input validation shared by both repositories (Spanish messages). Pure.
 */
import { validateDraft } from '@/domain/changes';
import { addDays, isISODate, startOfWeek, weekdayOf } from '@/domain/dates';
import {
  WEEK_PLAN_KINDS,
  type BusyBlockDraft,
  type DateRange,
  type ISODate,
  type JointSessionDraft,
  type NutritionDraft,
  type WeekPlan,
  type WeekPlanDraft,
  type WorkoutDraft,
} from '@/domain/types';

import { RepositoryError } from '../repository';

export const MAX_FRIEND_WEEK_DAYS = 31;

export function assertWorkoutDraft(draft: Partial<WorkoutDraft>, partial: boolean): void {
  const error = validateDraft(draft, partial);
  if (error) throw new RepositoryError('validation', error);
}

export function daysBetweenInclusive(range: DateRange): number {
  const from = Date.parse(`${range.from}T12:00:00Z`);
  const to = Date.parse(`${range.to}T12:00:00Z`);
  return Math.round((to - from) / 86_400_000) + 1;
}

export function assertFriendRange(range: DateRange): void {
  const days = daysBetweenInclusive(range);
  if (!Number.isFinite(days) || days < 1) throw new RepositoryError('validation', 'El rango de fechas no es válido.');
  if (days > MAX_FRIEND_WEEK_DAYS) {
    throw new RepositoryError('validation', 'Solo puedes ver hasta 31 días del calendario de un amigo.');
  }
}

export function assertJointDraft(draft: JointSessionDraft): void {
  if (draft.title.trim().length === 0) throw new RepositoryError('validation', 'Ponle un título a la quedada.');
  if (draft.inviteeIds.length === 0 && draft.isOpen !== true) {
    throw new RepositoryError('validation', 'Invita al menos a un amigo o abre la quedada a todos tus amigos.');
  }
  if (!Number.isFinite(draft.durationMin) || draft.durationMin < 5 || draft.durationMin > 720) {
    throw new RepositoryError('validation', 'La duración debe estar entre 5 y 720 minutos.');
  }
  assertWorkoutDraft({ date: draft.date, startTime: draft.startTime ?? null, durationMin: draft.durationMin, title: draft.title }, false);
}

export function assertBusyDraft(draft: BusyBlockDraft): void {
  const start = Date.parse(draft.start);
  const end = Date.parse(draft.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RepositoryError('validation', 'El bloque ocupado debe terminar después de empezar.');
  }
  if (end - start > 24 * 60 * 60 * 1000) {
    throw new RepositoryError('validation', 'Un bloque ocupado no puede durar más de 24 horas.');
  }
}

export function assertLifeEventDates(startDate: string, endDate: string): void {
  if (endDate < startDate) throw new RepositoryError('validation', 'La fecha de fin no puede ser anterior al inicio.');
}

export function assertNutrition(draft: NutritionDraft): void {
  if (draft.description.trim().length === 0) throw new RepositoryError('validation', 'Describe qué has comido.');
}

export const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;
export const USERNAME_HELP = 'El usuario debe tener 3–24 caracteres: minúsculas, números, punto o guion bajo.';

// ---------------------------------------------------------------------------
// Season plan ("Plan → General")
// ---------------------------------------------------------------------------

/** Weeks ahead of the current one that can be adjusted. */
export const WEEK_PLAN_MAX_WEEKS = 52;
export const WEEK_PLAN_MAX_MINUTES = 3000;
export const WEEK_PLAN_NOTE_MAX = 300;
const WEEK_PLAN_SOURCES: readonly WeekPlan['source'][] = ['manual', 'ai_coach', 'claude'];

/** A draft ready to store: every field explicit. */
export type CleanWeekPlanDraft = Omit<WeekPlan, 'updatedAt'>;

/** Throws `validation` unless `weekStart` is a Monday from this week up to +52 weeks. */
export function assertWeekPlanWeek(weekStart: string, today: ISODate): void {
  if (!isISODate(weekStart) || weekdayOf(weekStart) !== 0) {
    throw new RepositoryError('validation', 'Cada semana del plan general empieza en lunes: elige el lunes de esa semana.');
  }
  const first = startOfWeek(today);
  if (weekStart < first || weekStart > addDays(first, WEEK_PLAN_MAX_WEEKS * 7)) {
    throw new RepositoryError('validation', 'Solo puedes ajustar semanas desde esta hasta dentro de un año.');
  }
}

function cleanMinutes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > WEEK_PLAN_MAX_MINUTES) {
    throw new RepositoryError('validation', 'El volumen de la semana debe estar entre 0 y 50 horas.');
  }
  return Math.round(value);
}

function cleanNote(value: string | null | undefined): string | null {
  const note = value?.trim();
  if (!note) return null;
  if (note.length > WEEK_PLAN_NOTE_MAX) {
    throw new RepositoryError('validation', `La nota de la semana no puede pasar de ${WEEK_PLAN_NOTE_MAX} caracteres.`);
  }
  return note;
}

/** Validates one draft (Spanish messages) and fills the defaults (source 'manual'). */
export function cleanWeekPlanDraft(draft: WeekPlanDraft, today: ISODate): CleanWeekPlanDraft {
  assertWeekPlanWeek(draft.weekStart, today);
  if (!(WEEK_PLAN_KINDS as readonly string[]).includes(draft.kind)) {
    throw new RepositoryError('validation', 'Elige qué semana es: carga, más volumen, descarga o semana libre.');
  }
  const source = draft.source ?? 'manual';
  if (!WEEK_PLAN_SOURCES.includes(source)) throw new RepositoryError('validation', 'El origen del ajuste no es válido.');
  return { weekStart: draft.weekStart, kind: draft.kind, targetMinutes: cleanMinutes(draft.targetMinutes), note: cleanNote(draft.note), source };
}

/** Validates every draft (all or nothing); one entry per week (the last one wins), ordered by week. */
export function cleanWeekPlanDrafts(drafts: readonly WeekPlanDraft[], today: ISODate): CleanWeekPlanDraft[] {
  const byWeek = new Map(drafts.map((d) => [d.weekStart, cleanWeekPlanDraft(d, today)] as const));
  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Throws `validation` for anything that is not a calendar date (delete by week). */
export function assertWeekStartDate(weekStart: string): void {
  if (!isISODate(weekStart)) throw new RepositoryError('validation', 'La semana no es válida.');
}
