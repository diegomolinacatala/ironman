import { useMemo } from 'react';

import { todayISO } from '@/domain/dates';
import { buildSeason, type SeasonOverview } from '@/domain/season';
import { useProfile, useRaces } from '@/data/queries';

/**
 * The season from this week to the target race (or 8 maintenance weeks) for a
 * compact preview (onboarding). Null while loading or without weekly hours.
 * Week plans are left out: a new athlete has none yet.
 */
export function useSeasonPreview(): SeasonOverview | null {
  const today = todayISO();
  const races = useRaces();
  const profile = useProfile();
  const raceList = races.data;
  const athlete = profile.data ?? null;
  return useMemo(() => {
    const hours = athlete?.availability.weeklyHoursTarget ?? 0;
    if (!athlete || !raceList || !(hours > 0)) return null;
    return buildSeason({ today, races: raceList, level: athlete.level, weeklyHoursTarget: hours });
  }, [today, raceList, athlete]);
}
