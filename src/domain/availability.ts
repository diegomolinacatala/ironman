/**
 * Availability modes (pure). Automatic (the default, also for profiles stored
 * before the mode existed): the athlete fills nothing in — the planner uses the
 * calendar's busy blocks and the waking day (07:00–22:00), aims for the
 * automatic weekly hours of `season.ts` (`autoWeeklyHours`), has no fixed rest
 * day (restDays.ts picks the least free day, or one easy day on big weeks) and
 * no training windows. Manual ("Ajustes avanzados"): the athlete's own hours,
 * rest day and windows.
 */
import { autoWeeklyHours, manualWeeklyHours, weeklyHoursFor } from './season';
import type { Availability, AvailabilityMode, AthleteLevel, RaceDistance } from './types';

export function availabilityMode(availability: Pick<Availability, 'mode'> | null | undefined): AvailabilityMode {
  return availability?.mode === 'manual' ? 'manual' : 'auto';
}

export function isAutoAvailability(availability: Pick<Availability, 'mode'> | null | undefined): boolean {
  return availabilityMode(availability) === 'auto';
}

/**
 * What the planner and the re-planner work with: in automatic mode no fixed
 * rest day and no windows (the calendar decides), long days and pool days kept.
 */
export function planningAvailability(availability: Availability): Availability {
  if (!isAutoAvailability(availability)) return availability;
  if (availability.mode === 'auto' && availability.restDay === null && availability.windows.length === 0) return availability;
  return { ...availability, mode: 'auto', restDay: null, windows: [] };
}

/** Hours of a normal week for this athlete and target race distance (manual or automatic). */
export function normalWeekHours(availability: Availability, level: AthleteLevel | null | undefined, distance: RaceDistance | null | undefined): number {
  return weeklyHoursFor(manualWeeklyHours(availability), level, distance);
}

export { autoWeeklyHours, manualWeeklyHours };
