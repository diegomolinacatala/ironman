import { useMemo } from 'react';

import { useWeather } from '@/data/queries';
import type { Workout } from '@/domain/types';

import { sessionWeatherView, type SessionWeatherView } from './weatherModel';

/** The weather of an outdoor session from the athlete's city forecast; null without a city or indoors. */
export function useSessionWeather(workout: Workout | null, today: string): SessionWeatherView | null {
  const forecast = useWeather().data ?? null;
  return useMemo(() => (workout ? sessionWeatherView(forecast, workout, today, new Date()) : null), [forecast, workout, today]);
}
