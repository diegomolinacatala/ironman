import { todayISO } from '@/domain/dates';
import { nextRace } from '@/domain/periodization';
import type { RaceDistance, Thresholds } from '@/domain/types';
import { useProfile, useRaces } from '@/data/queries';

export interface AthleteTargets {
  /** The athlete's thresholds; null while the profile loads or without a profile. */
  thresholds: Thresholds | null;
  /** Distance of the next target race: decides what "ritmo de carrera" means. */
  raceDistance: RaceDistance | null;
  /** The profile query has answered (hints about missing thresholds wait for it). */
  profileLoaded: boolean;
}

/** What the workout screens need to turn zones into ppm / pace / watts. */
export function useAthleteTargets(): AthleteTargets {
  const profile = useProfile();
  const races = useRaces();
  return {
    thresholds: profile.data?.thresholds ?? null,
    raceDistance: nextRace(races.data ?? [], todayISO())?.distance ?? null,
    profileLoaded: profile.data != null,
  };
}
