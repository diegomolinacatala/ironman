/**
 * One-line summaries for the folded Plan screen (pure, unit-tested): a closed day still says
 * what is in it, and the closed week summary says how the week is going.
 */
import { formatDuration } from '@/domain/dates';
import type { WeekSummary } from '@/domain/load';
import type { ISODate, Workout } from '@/domain/types';

import { hoursLabel } from './weekModel';

function training(workouts: readonly Workout[]): Workout[] {
  return workouts.filter((w) => w.sport !== 'rest');
}

/** "Natación fondo 6×300 m · Carrera tempo 2×12'" → titles, or "Descanso" / "Libre". */
export function daySessionsLine(workouts: readonly Workout[], isPast: boolean): string {
  const sessions = training(workouts);
  if (sessions.length === 0) return workouts.length ? 'Descanso' : isPast ? 'Sin sesiones' : 'Libre';
  return sessions.map((w) => w.title).join(' · ');
}

/** "1h 57'" of planned sessions (null when the day is empty). */
export function dayDurationLabel(workouts: readonly Workout[]): string | null {
  const minutes = training(workouts).reduce((sum, w) => sum + (w.durationMin ?? 0), 0);
  return minutes > 0 ? formatDuration(minutes) : null;
}

export type DayState = 'done' | 'partial' | 'missed' | 'planned' | 'adjusted' | 'empty';

/** Done when every session is completed; missed when a past day has sessions left. */
export function dayState(workouts: readonly Workout[], date: ISODate, today: ISODate): DayState {
  const sessions = training(workouts);
  if (sessions.length === 0) return 'empty';
  const active = sessions.filter((w) => w.status !== 'skipped');
  if (active.length === 0) return 'adjusted';
  const completed = active.filter((w) => w.status === 'completed').length;
  if (completed === active.length) return 'done';
  if (date < today) return completed > 0 ? 'partial' : 'missed';
  return completed > 0 ? 'partial' : 'planned';
}

/** Open today's agenda by default. */
export function dayOpenByDefault(date: ISODate, today: ISODate): boolean {
  return date === today;
}

/** "7,6 de 9,8 h · 98 % cumplido" for the closed week summary. */
export function weekSummaryLine(summary: WeekSummary): string {
  const hours = `${hoursLabel(summary.completedMin)} de ${hoursLabel(summary.plannedMin)} h`;
  if (summary.compliancePct == null) return summary.sessions > 0 ? `${hours} · ${summary.sessions} sesiones` : 'Semana en blanco';
  return `${hours} · ${Math.round(summary.compliancePct * 100)} % cumplido`;
}
