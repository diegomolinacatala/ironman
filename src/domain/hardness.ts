/**
 * "Hard points" per session and per day (docs/research/02 §10.1). A day with
 * ≥ 1 point is a hard day; the planner never puts two hard days in a row
 * (except a valid BIG_WEEKEND) and the re-planner keeps that invariant.
 */
import { HARD_DAY_THRESHOLD, HARD_POINTS, LONG_SCALING, OTHER_SPORT_PROFILES } from './constants';
import { BIKE_SESSION_IF, RUN_SESSION_IF } from './constants';
import { intensityRank } from './restrictions';
import type { Intensity, LifeEvent, Sport } from './types';

export interface HardnessInput {
  sport: Sport;
  intensity: Intensity;
  durationMin: number;
}

const TEMPO = intensityRank('tempo');
const THRESHOLD = intensityRank('threshold');

/** Long-session points with the §10.1 scaling (short longs count 0.5). */
export function longPoints(sport: Sport, intensity: Intensity, durationMin: number): number {
  if (sport === 'run') {
    const full = durationMin >= LONG_SCALING.runFullMin || RUN_SESSION_IF[intensity] >= LONG_SCALING.runFullIF;
    return full ? HARD_POINTS.long : HARD_POINTS.longShort;
  }
  const full = durationMin >= LONG_SCALING.bikeFullMin || BIKE_SESSION_IF[intensity] >= LONG_SCALING.bikeFullIF;
  return full ? HARD_POINTS.long : HARD_POINTS.longShort;
}

/** Hard points of any workout, inferred from sport, intensity and duration. */
export function workoutHardPoints(w: HardnessInput): number {
  const rank = intensityRank(w.intensity);
  switch (w.sport) {
    case 'rest':
    case 'mobility':
      return 0;
    case 'strength':
      return rank >= TEMPO ? HARD_POINTS.strengthHeavy : HARD_POINTS.strengthMaint;
    case 'swim':
      return rank >= THRESHOLD ? HARD_POINTS.swimQuality : 0;
    case 'brick':
      return w.intensity === 'race' && w.durationMin >= 150 ? HARD_POINTS.race : HARD_POINTS.brick;
    default:
      break;
  }
  if (w.intensity === 'race' && w.durationMin >= 150) return HARD_POINTS.race;
  if (rank >= TEMPO) return w.sport === 'other' ? HARD_POINTS.otherHard : HARD_POINTS.quality;
  if (w.sport === 'run' && w.durationMin >= 60) return longPoints('run', w.intensity, w.durationMin);
  if (w.sport === 'bike' && w.durationMin >= 120) return longPoints('bike', w.intensity, w.durationMin);
  if (w.sport === 'other' && w.durationMin >= 60) return HARD_POINTS.otherEndurance;
  return 0;
}

/** Hard points of an other-sport life event (pádel, fútbol…); 0 for non-sport events. */
export function lifeEventHardPoints(e: LifeEvent): number {
  if (e.kind !== 'padel' && e.kind !== 'football' && e.kind !== 'other_sport') return 0;
  const profile = OTHER_SPORT_PROFILES[e.kind];
  const base = profile.hardPointsBySeverity[Math.min(Math.max(e.severity, 1), 3) - 1] ?? HARD_POINTS.otherHard;
  const long = (e.durationMin ?? profile.defaultDurationMin) > 90;
  return long ? Math.max(base, HARD_POINTS.otherHard) : base;
}

export function isHardDay(points: number): boolean {
  return points >= HARD_DAY_THRESHOLD;
}
