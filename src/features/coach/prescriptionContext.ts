/**
 * What the coach surfaces need to turn a session into concrete targets (the
 * athlete's thresholds and the distance of the target race, which decides
 * "ritmo de carrera"), plus the one-line main target that reminders and
 * widgets show ("Z4 · 162–168 ppm"). Pure.
 */
import { nextRace } from '@/domain/periodization';
import type { ISODate, Race, RaceDistance, Thresholds } from '@/domain/types';
import { mainTargets, targetParts, zoneName, zoneSportOf, type SessionShape } from '@/domain/zones';

export interface PrescriptionContext {
  thresholds: Thresholds | null;
  /** Distance of the next target race (A first), null without races. */
  raceDistance: RaceDistance | null;
}

export const NO_PRESCRIPTION_CONTEXT: PrescriptionContext = { thresholds: null, raceDistance: null };

export function prescriptionContext(
  thresholds: Thresholds | null | undefined,
  races: readonly Race[] | null | undefined,
  today: ISODate,
): PrescriptionContext {
  return { thresholds: thresholds ?? null, raceDistance: nextRace(races ?? [], today)?.distance ?? null };
}

function zoneLabel(workout: SessionShape, leg: 'bike' | 'run' | null, intensity: SessionShape['intensity']): string {
  const zs = zoneSportOf(workout.sport, leg);
  if (zs !== 'run' && zs !== 'bike' && zs !== 'swim') return '';
  // "Carrera" is also the sport label of running: say "Ritmo carrera" next to it.
  return intensity === 'race' ? 'Ritmo carrera' : zoneName(intensity);
}

/**
 * Zone + the sport's primary target of the main set ("Z4 · 162–168 ppm",
 * "Z2 · 185–225 W", "RPE 6–7" for strength); without thresholds the zone and
 * RPE ("Z4 · RPE 7–8"). '' for rest days (widgets and plists never get null).
 */
export function mainTargetLine(workout: SessionShape, ctx: Partial<PrescriptionContext> = {}): string {
  if (workout.sport === 'rest') return '';
  const { set, targets } = mainTargets(workout, ctx.thresholds ?? null, { raceDistance: ctx.raceDistance ?? null });
  const leg = set?.step.leg ?? null;
  const zone = zoneLabel(workout, leg, set?.intensity ?? workout.intensity);
  const primary = targetParts(targets, workout.sport, leg)[0] ?? '';
  return [zone, primary].filter(Boolean).join(' · ');
}
