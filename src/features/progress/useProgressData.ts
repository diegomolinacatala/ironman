/**
 * Loads and derives everything the Progreso tab shows.
 */
import { useMemo } from 'react';

import { useLifeEvents, useMetrics, useRaces, useWorkouts } from '@/data/queries';
import { nextRace, phaseFor } from '@/domain/periodization';
import type { ISODate, Race } from '@/domain/types';
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

  const pmc = useMemo(
    () => (workouts.data ? buildPmcSeries({ workouts: workouts.data, events: events.data ?? [], today }) : null),
    [workouts.data, events.data, today],
  );
  const volume = useMemo(() => (workouts.data ? buildVolumeWeeks(workouts.data, today) : []), [workouts.data, today]);
  const recovery = useMemo(() => buildRecoverySeries(metrics.data ?? [], today), [metrics.data, today]);
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
    isLoading: workouts.isLoading || races.isLoading,
    error: firstError ? errorMessage(firstError, 'No se ha podido cargar tu progreso.') : null,
    isRefetching: workouts.isRefetching || metrics.isRefetching,
    refetch: () => {
      void workouts.refetch();
      void events.refetch();
      void metrics.refetch();
      void races.refetch();
    },
  };
}
