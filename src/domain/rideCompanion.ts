/**
 * «¿Sales con alguien?» (pure, app only): rides on the road are presumed social, trainer
 * sessions are not. For every athlete, Hoy asks once per outdoor bike session of the next days
 * (planned, not a quedada yet) whether they go with someone: a friend prefills a quedada with
 * that workout (`/joint/new`, never sent without the athlete), «Solo» closes it. One question at
 * a time; each workout is asked once (remembered on the device).
 */
import { addDays } from './dates';
import type { ISODate, Workout } from './types';
import { isOutdoorSession } from './weather';

/** Today and the next two days. */
export const RIDE_ASK_DAYS = 3;
/** Workout ids remembered on the device (oldest dropped). */
export const RIDE_ASKED_KEPT = 60;

/** An outdoor ride to ask about: planned bike on the road, no quedada linked. */
export function isAskableRide(w: Workout): boolean {
  return w.status === 'planned' && w.sport === 'bike' && w.jointSessionId === null && isOutdoorSession(w);
}

/** The next outdoor ride of today..today+2 not asked yet, soonest first (null when none). */
export function nextRideToAsk(input: { workouts: readonly Workout[]; today: ISODate; asked: readonly string[] }): Workout | null {
  const last = addDays(input.today, RIDE_ASK_DAYS - 1);
  const asked = new Set(input.asked);
  return (
    input.workouts
      .filter((w) => w.date >= input.today && w.date <= last && isAskableRide(w) && !asked.has(w.id))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.id.localeCompare(b.id))[0] ?? null
  );
}

/** The remembered ids with `id` added (newest last, capped). */
export function rememberAsked(asked: readonly string[], id: string): string[] {
  return [...asked.filter((x) => x !== id), id].slice(-RIDE_ASKED_KEPT);
}
