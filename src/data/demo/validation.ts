/**
 * Input validation shared by both repositories (Spanish messages). Pure.
 */
import { validateDraft } from '@/domain/changes';
import type { BusyBlockDraft, DateRange, JointSessionDraft, NutritionDraft, WorkoutDraft } from '@/domain/types';

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
  if (draft.inviteeIds.length === 0) throw new RepositoryError('validation', 'Invita al menos a un amigo.');
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
