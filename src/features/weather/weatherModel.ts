/**
 * What the screens say about the weather (pure): the Tú row, the line on
 * today's session and the Plan hint for athletes without a city.
 */
import type { Profile, WeatherPlace, Workout } from '@/domain/types';
import { isOutdoorSession, sessionWeather, weatherLine, type SessionWeather, type WeatherForecast, type WeatherSource } from '@/domain/weather';

/** Tú › Entrenamiento: "Valencia · la lluvia y el viento cuentan al planificar" or the nudge. */
export function placeRowSubtitle(place: WeatherPlace | null | undefined): string {
  return place ? `${place.name} · la lluvia y el viento cuentan al planificar` : 'Para tener en cuenta la lluvia y el viento';
}

export interface SessionWeatherView {
  weather: SessionWeather;
  /** One quiet line, or null when there is nothing to say. */
  line: string | null;
  /** Rain at the session's time. */
  rainy: boolean;
  /** Rain, or wind worth a warning (notice or strong): shown on the card itself (else inside the details). */
  onCard: boolean;
  /** The icon of the line: rain first, then wind. */
  icon: 'rain' | 'wind' | 'cloudSun';
  source: WeatherSource;
}

/** Local minutes now (the hours already gone today are not suggested). */
export function minutesOf(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** The weather of today's (or any day's) outdoor session; null when it is indoors or unknown. */
export function sessionWeatherView(forecast: WeatherForecast | null | undefined, workout: Workout, today: string, now: Date): SessionWeatherView | null {
  if (!forecast || !isOutdoorSession(workout)) return null;
  const weather = sessionWeather(forecast.hours, workout, workout.date === today ? { afterMin: minutesOf(now) } : {});
  const line = weatherLine(weather, workout.sport);
  if (!line) return null;
  const rainy = weather.kind === 'rain';
  const windy = 'wind' in weather && weather.wind !== undefined;
  return { weather, line, rainy, onCard: rainy || windy, icon: rainy ? 'rain' : windy ? 'wind' : 'cloudSun', source: forecast.source };
}

/** Plan: one quiet hint without a city, only when the week has outdoor sessions still to do. */
export function needsPlaceHint(profile: Pick<Profile, 'weatherPlace'> | null | undefined, workouts: readonly Workout[], today: string): boolean {
  if (!profile || profile.weatherPlace) return false;
  return workouts.some((w) => w.status === 'planned' && w.date >= today && isOutdoorSession(w));
}
