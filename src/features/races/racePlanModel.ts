/**
 * Which race gets the "Plan de carrera" section on Carreras and how it is shown
 * (pure): the next A race with known legs; highlighted and open from three
 * weeks before.
 */
import { diffDays } from '@/domain/dates';
import { buildRacePlan, type RacePlan } from '@/domain/racePlan';
import type { AthleteLevel, ISODate, Race, Thresholds } from '@/domain/types';

/** From this many days before the race, the plan is highlighted and opens by default. */
export const RACE_PLAN_HIGHLIGHT_DAYS = 21;

export interface RacePlanView {
  race: Race;
  plan: RacePlan;
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
  /** Expected leg minutes (prediction) to time the fueling. */
  legMinutes?: { swim?: number; bike?: number; run?: number } | null;
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

/** Null when there is no upcoming A race or its distance has no plan ('other'). */
export function racePlanView(input: RacePlanViewInput): RacePlanView | null {
  const race = nextARace(input.races, input.today);
  if (!race) return null;
  const plan = buildRacePlan({ distance: race.distance, thresholds: input.thresholds, level: input.level, legMinutes: input.legMinutes });
  if (!plan) return null;
  const daysToRace = diffDays(race.date, input.today);
  const highlighted = daysToRace <= RACE_PLAN_HIGHLIGHT_DAYS;
  return { race, plan, daysToRace, highlighted, badge: highlighted ? badgeFor(daysToRace) : null };
}
