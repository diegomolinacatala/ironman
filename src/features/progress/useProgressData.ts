/**
 * Loads and derives everything the Progreso tab shows (form, volume, recovery, today's
 * nutrition and the next race).
 */
import { useMemo } from 'react';

import { useLifeEvents, useMetrics, useNutrition, useRaces, useWorkouts } from '@/data/queries';
import { nextRace, phaseFor } from '@/domain/periodization';
import type { ISODate, Race } from '@/domain/types';
import { dayTotals, type DayTotals } from '@/features/nutrition/nutritionModel';
import { errorMessage } from '@/lib/logger';

import { buildPmcSeries, pmcRanges, type PmcSeries } from './pmcModel';
import { buildRecoverySeries, recoveryRange, type RecoverySeries } from './recoveryModel';
import { buildVolumeWeeks, type VolumeWeek } from './volumeModel';

export interface ProgressData {
  pmc: PmcSeries | null;
  volume: VolumeWeek[];
  recovery: RecoverySeries[];
  race: Race | null;
  phase: ReturnType<typeof phaseFor> | null;
  /** Today's nutrition log summary (null until loaded). */
  nutrition: { totals: DayTotals; entries: number } | null;
  isLoading: boolean;
  error: string | null;
  isRefetching: boolean;
  refetch: () => void;
}

export function useProgressData(today: ISODate): ProgressData {
  const { fetch } = pmcRanges(today);
  const workouts = useWorkouts(fetch);
  const events = useLifeEvents(fetch);
  const metrics = useMetrics(recoveryRange(today));
  const races = useRaces();
  const meals = useNutrition({ from: today, to: today });

  const pmc = useMemo(
    () => (workouts.data ? buildPmcSeries({ workouts: workouts.data, events: events.data ?? [], today }) : null),
    [workouts.data, events.data, today],
  );
  const volume = useMemo(() => (workouts.data ? buildVolumeWeeks(workouts.data, today) : []), [workouts.data, today]);
  const recovery = useMemo(() => buildRecoverySeries(metrics.data ?? [], today), [metrics.data, today]);
  const nutrition = useMemo(
    () => (meals.data ? { totals: dayTotals(meals.data), entries: meals.data.length } : null),
    [meals.data],
  );
  const raceList = races.data ?? [];
  const race = nextRace(raceList, today);
  const phase = raceList.length > 0 ? phaseFor(today, raceList) : null;

  const firstError = workouts.error ?? events.error ?? metrics.error ?? races.error;
  return {
    pmc,
    volume,
    recovery,
    race,
    phase,
    nutrition,
    isLoading: workouts.isLoading || races.isLoading,
    error: firstError ? errorMessage(firstError, 'No se ha podido cargar tu progreso.') : null,
    isRefetching: workouts.isRefetching || metrics.isRefetching,
    refetch: () => {
      void workouts.refetch();
      void events.refetch();
      void metrics.refetch();
      void races.refetch();
      void meals.refetch();
    },
  };
}
