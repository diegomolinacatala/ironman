import { useMemo } from 'react';

import { todayISO } from '@/domain/dates';
import { buildSeason, type SeasonOverview, type SeasonWeek } from '@/domain/season';
import { seasonWeekDetail } from '@/domain/seasonSessions';
import type { ISODate, Profile, Race } from '@/domain/types';
import { useProfile, useRaces, useWeekPlans, useWorkouts } from '@/data/queries';
import { logger } from '@/lib/logger';

import type { AdjustContext } from './adjustModel';
import { seasonRange, sessionsByWeek } from './seasonModel';

export interface SeasonData {
  today: ISODate;
  /** Null until races and profile are loaded (or when there is no profile). */
  season: SeasonOverview | null;
  /** Planned sessions per week (Monday → count): "Detallada · 6 sesiones". */
  sessions: Readonly<Record<ISODate, number>>;
  /** Key sessions per week (Monday → coach names). */
  keySessions: Readonly<Record<ISODate, readonly string[]>>;
  /** What "Ajustar semana" needs to price each option. */
  adjustContext: AdjustContext | null;
  /** Loaded, but there is no profile (weekly hours) to plan from. */
  missingProfile: boolean;
  isLoading: boolean;
  error: unknown;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

const NO_KEY_SESSIONS: readonly string[] = [];

function keySessionsOf(week: SeasonWeek, profile: Profile, races: readonly Race[]): readonly string[] {
  try {
    return seasonWeekDetail(week, { profile, races }).keySessions;
  } catch (error) {
    // One odd week must not take the whole overview down: it just shows no key sessions.
    logger.warn('season: key sessions failed', error);
    return NO_KEY_SESSIONS;
  }
}

/**
 * Everything Plan → General needs: the season from this week to the target race
 * (or 8 maintenance weeks) with the athlete's week plans, which weeks already
 * have sessions, and each week's key sessions.
 */
export function useSeasonData(): SeasonData {
  const today = todayISO();
  const races = useRaces();
  const profile = useProfile();
  const raceList = races.data;
  const range = useMemo(() => seasonRange(today, raceList ?? []), [today, raceList]);
  const weekPlans = useWeekPlans(range);
  const workouts = useWorkouts(range);
  const athlete = profile.data ?? null;

  const season = useMemo(() => {
    if (!athlete || !raceList) return null;
    return buildSeason({
      today,
      races: raceList,
      level: athlete.level,
      weeklyHoursTarget: athlete.availability.weeklyHoursTarget,
      weekPlans: weekPlans.data ?? [],
    });
  }, [today, raceList, athlete, weekPlans.data]);

  const keySessions = useMemo(() => {
    if (!season || !athlete || !raceList) return {};
    return Object.fromEntries(season.weeks.map((w) => [w.weekStart, keySessionsOf(w, athlete, raceList)]));
  }, [season, athlete, raceList]);

  const sessions = useMemo(() => sessionsByWeek(workouts.data ?? []), [workouts.data]);
  const adjustContext = useMemo<AdjustContext | null>(
    () => (athlete && raceList ? { races: raceList, level: athlete.level, weeklyHoursTarget: athlete.availability.weeklyHoursTarget } : null),
    [athlete, raceList],
  );

  const all = [races, profile, weekPlans, workouts];
  return {
    today,
    season,
    sessions,
    keySessions,
    adjustContext,
    missingProfile: !profile.isLoading && !profile.error && athlete === null,
    isLoading: all.some((q) => q.isLoading),
    error: all.find((q) => q.error)?.error ?? null,
    isRefreshing: all.some((q) => q.isRefetching),
    refresh: async () => {
      await Promise.all(all.map((q) => q.refetch()));
    },
  };
}
