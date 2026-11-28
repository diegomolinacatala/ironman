/**
 * What the post-workout analysis sends to the model: the session (plan,
 * targets, what was done and the plan-vs-done line), that morning's check-in
 * (journal answers in words), the last 7 days of load and tomorrow's plan.
 * Pure: the caller loads the rows.
 */
import { addDays } from '../dates.ts';
import { athleteView } from '../planning/athlete-view.ts';
import { checkinView } from '../planning/context.ts';
import { nextRace } from '../planning/domain/periodization.ts';
import { weekTotals } from '../planning/load.ts';
import { workoutView } from '../planning/workout-view.ts';
import type { DailyCheckin, Profile, Race, Workout } from '../types.ts';

export interface AnalysisInput {
  workout: Workout;
  profile: Profile;
  races: readonly Race[];
  /** Workouts from 6 days before the session to the day after it. */
  workouts: readonly Workout[];
  checkin: DailyCheckin | null;
}

/** The user message: labelled JSON blocks the system prompt describes. */
export function analysisMessage(input: AnalysisInput): string {
  const { workout, profile } = input;
  const race = nextRace(input.races, workout.date);
  const raceDistance = race?.distance ?? null;
  const view = { detail: 'detailed' as const, sessions: [], userId: profile.id, thresholds: profile.thresholds, raceDistance, today: workout.date };
  const lastWeek = input.workouts.filter((w) => w.date > addDays(workout.date, -7) && w.date <= workout.date);
  const tomorrow = input.workouts.filter((w) => w.date === addDays(workout.date, 1) && w.status === 'planned');
  const notes = workout.completed?.notes?.trim();
  const lines = [
    `Sesión del ${workout.date} (JSON): ${JSON.stringify(workoutView(workout, view))}`,
    notes ? `Notas del atleta al terminar: "${notes.slice(0, 500)}"` : 'El atleta no ha dejado notas.',
    input.checkin ? `Check-in de esa mañana (JSON): ${JSON.stringify(checkinView(input.checkin))}` : 'No hizo el check-in esa mañana.',
    `Atleta (JSON): ${JSON.stringify(athleteView(profile, raceDistance))}`,
    race ? `Próxima carrera: ${race.name} (${race.date}).` : 'Sin carrera objetivo.',
    `Carga de los últimos 7 días (JSON): ${JSON.stringify(weekTotals(lastWeek))}`,
    tomorrow.length > 0
      ? `Mañana tiene planificado (JSON): ${JSON.stringify(tomorrow.map((w) => ({ title: w.title, sport: w.sport, durationMin: w.durationMin, intensity: w.intensity })))}`
      : 'Mañana no tiene nada planificado.',
  ];
  return lines.join('\n');
}
