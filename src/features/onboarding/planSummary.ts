/**
 * "Tu plan" step (pure): which weeks to generate and a 3-line summary of what
 * was added, in plain Spanish.
 */
import { addDays, formatDayLabel, formatDuration, startOfWeek, weekdayOf } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { ISODate, PlanChange, Sport, WorkoutDraft } from '@/domain/types';

import { joinEs } from './connectModel';

/** Friday or later: so few days are left that next week is planned too. */
const LATE_WEEKDAY = 4;

/** This Monday, plus next Monday when this week is nearly over. */
export function weeksToPlan(today: ISODate): ISODate[] {
  const monday = startOfWeek(today);
  return weekdayOf(today) >= LATE_WEEKDAY ? [monday, addDays(monday, 7)] : [monday];
}

function addedWorkouts(changes: readonly PlanChange[], today: ISODate): WorkoutDraft[] {
  return changes
    .flatMap((c) => (c.op === 'add' ? [c.workout] : []))
    .filter((w) => w.date >= today && w.sport !== 'rest')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

function sportCount(sport: Sport, n: number): string {
  return `${n} de ${sportLabel(sport).toLowerCase()}`;
}

function keySession(workouts: readonly WorkoutDraft[]): WorkoutDraft | null {
  const key = workouts.find((w) => w.isKey);
  if (key) return key;
  return [...workouts].sort((a, b) => b.durationMin - a.durationMin)[0] ?? null;
}

/** Up to three short lines: sessions & time, the key session, the sport mix. */
export function planSummary(changes: readonly PlanChange[], today: ISODate): string[] {
  const workouts = addedWorkouts(changes, today);
  if (workouts.length === 0) {
    const touched = changes.length > 0;
    return [touched ? 'He ajustado tu semana a lo que me has contado.' : 'Tu semana ya tenía plan: lo dejamos como está.'];
  }
  const totalMin = workouts.reduce((sum, w) => sum + w.durationMin, 0);
  const sessions = workouts.length === 1 ? '1 sesión' : `${workouts.length} sesiones`;
  const lines = [`${sessions} en los próximos días · ${formatDuration(totalMin)} en total`];
  const key = keySession(workouts);
  if (key) lines.push(`La clave: ${key.title}, ${formatDayLabel(key.date, today).toLowerCase()} (${formatDuration(key.durationMin)})`);
  const counts = new Map<Sport, number>();
  workouts.forEach((w) => counts.set(w.sport, (counts.get(w.sport) ?? 0) + 1));
  const mix = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([sport, n]) => sportCount(sport, n));
  if (mix.length > 0) lines.push(`Reparto: ${joinEs(mix)}`);
  return lines.slice(0, 3);
}
