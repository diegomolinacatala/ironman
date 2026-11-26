/**
 * Which race gets the "Plan de carrera" section on Carreras and how it is shown
 * (pure): the next A race with known legs; highlighted and open from three
 * weeks before. Also its finish-time prediction, whose leg times time the fueling.
 */
import { addDays, diffDays } from '@/domain/dates';
import { buildRacePlan, type RacePlan } from '@/domain/racePlan';
import { centralLegMinutes, predictRace, type PredictionOutcome, type RidePoint } from '@/domain/racePrediction';
import type { AthleteLevel, DateRange, ISODate, Race, Thresholds, Workout } from '@/domain/types';

/** From this many days before the race, the plan is highlighted and opens by default. */
export const RACE_PLAN_HIGHLIGHT_DAYS = 21;
/** Rides that can stand in for FTP in the bike prediction: the last 8 weeks. */
export const RECENT_RIDES_DAYS = 56;

export interface RacePlanView {
  race: Race;
  plan: RacePlan;
  /** Finish-time range, or why it is hidden; null when the distance has no legs. */
  prediction: PredictionOutcome | null;
  daysToRace: number;
  highlighted: boolean;
  /** Tag shown while highlighted ("En 12 días", "Mañana", "Hoy"), else null. */
  badge: string | null;
}

export interface RacePlanViewInput {
  races: readonly Race[];
  today: ISODate;
  thresholds?: Thresholds | null;
  level?: AthleteLevel | null;
  /** Completed rides (see `ridePoints`), used by the prediction without FTP. */
  recentRides?: readonly RidePoint[] | null;
}

/** The next A race from today (the earliest; ties keep the list order). */
export function nextARace(races: readonly Race[], today: ISODate): Race | null {
  const upcoming = races.filter((r) => r.priority === 'A' && r.date >= today);
  return upcoming.reduce<Race | null>((best, r) => (best === null || r.date < best.date ? r : best), null);
}

function badgeFor(days: number): string {
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

/** Window of workouts `ridePoints` looks at. */
export function recentRidesRange(today: ISODate): DateRange {
  return { from: addDays(today, -RECENT_RIDES_DAYS), to: today };
}

/** Completed rides with distance and duration (the watch's numbers), for the prediction. */
export function ridePoints(workouts: readonly Workout[] | undefined): RidePoint[] {
  return (workouts ?? []).flatMap((w) => {
    const done = w.completed;
    if (w.status !== 'completed' || w.sport !== 'bike' || !done?.durationMin || !done.distanceM) return [];
    return [{ date: w.date, durationMin: done.durationMin, distanceM: done.distanceM, avgHr: done.avgHr ?? null }];
  });
}

/** Null when there is no upcoming A race or its distance has no plan ('other'). */
export function racePlanView(input: RacePlanViewInput): RacePlanView | null {
  const race = nextARace(input.races, input.today);
  if (!race) return null;
  const prediction = predictRace({ distance: race.distance, thresholds: input.thresholds, level: input.level, recentRides: input.recentRides });
  const legMinutes = prediction?.ok ? centralLegMinutes(prediction.prediction) : null;
  const plan = buildRacePlan({ distance: race.distance, thresholds: input.thresholds, level: input.level, legMinutes });
  if (!plan) return null;
  const daysToRace = diffDays(race.date, input.today);
  const highlighted = daysToRace <= RACE_PLAN_HIGHLIGHT_DAYS;
  return { race, plan, prediction, daysToRace, highlighted, badge: highlighted ? badgeFor(daysToRace) : null };
}
