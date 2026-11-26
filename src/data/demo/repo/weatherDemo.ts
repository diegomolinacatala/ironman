/**
 * Demo stand-ins for the `weather` edge function: a small list of Spanish
 * cities for the search (no network) and a simulated, deterministic forecast
 * for the city on the profile (`source: 'demo'`: the app says it is an example,
 * never MET Norway). The pattern of each day (dry, morning or evening rain,
 * showers, rain all day) comes from the date and the city, so the web preview
 * shows every case without randomness; days 3–9 come in 6-hour blocks like MET.
 */
import { addDays } from '@/domain/dates';
import type { ISODate, WeatherPlaceOption } from '@/domain/types';
import type { WeatherForecast, WeatherHour } from '@/domain/weather';

import { RepositoryError, type Repository } from '../../repository';
import { requireMe, type DemoDeps } from './common';

type WeatherMethods = Required<Pick<Repository, 'getWeather' | 'searchWeatherPlaces'>>;

export const DEMO_PLACES: readonly WeatherPlaceOption[] = [
  { name: 'Madrid', detail: 'Comunidad de Madrid, España', lat: 40.4168, lon: -3.7038 },
  { name: 'Barcelona', detail: 'Cataluña, España', lat: 41.3874, lon: 2.1686 },
  { name: 'Valencia', detail: 'Comunidad Valenciana, España', lat: 39.4699, lon: -0.3763 },
  { name: 'Sevilla', detail: 'Andalucía, España', lat: 37.3891, lon: -5.9845 },
  { name: 'Zaragoza', detail: 'Aragón, España', lat: 41.6488, lon: -0.8891 },
  { name: 'Málaga', detail: 'Andalucía, España', lat: 36.7213, lon: -4.4214 },
  { name: 'Murcia', detail: 'Región de Murcia, España', lat: 37.9922, lon: -1.1307 },
  { name: 'Palma', detail: 'Islas Baleares, España', lat: 39.5696, lon: 2.6502 },
  { name: 'Las Palmas de Gran Canaria', detail: 'Canarias, España', lat: 28.1235, lon: -15.4363 },
  { name: 'Bilbao', detail: 'País Vasco, España', lat: 43.263, lon: -2.935 },
  { name: 'Alicante', detail: 'Comunidad Valenciana, España', lat: 38.3452, lon: -0.481 },
  { name: 'Córdoba', detail: 'Andalucía, España', lat: 37.8882, lon: -4.7794 },
  { name: 'Valladolid', detail: 'Castilla y León, España', lat: 41.6523, lon: -4.7245 },
  { name: 'Vigo', detail: 'Galicia, España', lat: 42.2406, lon: -8.7207 },
  { name: 'Gijón', detail: 'Asturias, España', lat: 43.5322, lon: -5.6611 },
  { name: 'A Coruña', detail: 'Galicia, España', lat: 43.3623, lon: -8.4115 },
  { name: 'Granada', detail: 'Andalucía, España', lat: 37.1773, lon: -3.5986 },
  { name: 'Vitoria-Gasteiz', detail: 'País Vasco, España', lat: 42.8467, lon: -2.6716 },
  { name: 'Pamplona', detail: 'Navarra, España', lat: 42.8125, lon: -1.6458 },
  { name: 'San Sebastián', detail: 'País Vasco, España', lat: 43.3183, lon: -1.9812 },
  { name: 'Santander', detail: 'Cantabria, España', lat: 43.4623, lon: -3.81 },
  { name: 'Salamanca', detail: 'Castilla y León, España', lat: 40.9701, lon: -5.6635 },
  { name: 'Valencia', detail: 'Carabobo, Venezuela', lat: 10.162, lon: -68.0077 },
];

const MAX_RESULTS = 6;
const FORECAST_DAYS = 9;
const HOURLY_DAYS = 3;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Demo city search: accent-insensitive, names starting with the query first. */
export function searchDemoPlaces(query: string): WeatherPlaceOption[] {
  const q = fold(query);
  const matches = DEMO_PLACES.filter((p) => fold(p.name).includes(q) || fold(p.detail).startsWith(q));
  return [...matches.filter((p) => fold(p.name).startsWith(q)), ...matches.filter((p) => !fold(p.name).startsWith(q))].slice(0, MAX_RESULTS);
}

type DayPattern = (hour: number) => number;

const PATTERNS: readonly DayPattern[] = [
  () => 0,
  (h) => (h >= 17 && h < 21 ? 1.4 : 0),
  (h) => (h >= 7 && h < 13 ? 1.1 : 0),
  () => 0,
  (h) => (h >= 8 && h < 22 ? 1.8 : 0),
  (h) => (h === 11 || h === 16 ? 0.8 : 0),
];

function seed(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return hash;
}

function dayHours(date: ISODate, pattern: DayPattern, coarse: boolean, warm: number): WeatherHour[] {
  return Array.from({ length: 24 }, (_, hour) => {
    // 6-hour blocks: the same average amount every hour of the block, like MET.
    const block = Math.floor(hour / 6) * 6;
    const mm = coarse ? Array.from({ length: 6 }, (_, k) => pattern(block + k)).reduce((s, v) => s + v, 0) / 6 : pattern(hour);
    const tempC = Math.round((warm + 5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI)) * 10) / 10;
    return { date, hour, tempC, windKmh: 8 + ((hour * 7) % 15), precipMm: Math.round(mm * 100) / 100, precipProb: null, symbol: mm >= 0.1 ? 'rain' : 'partlycloudy_day', coarse };
  });
}

/** Deterministic example forecast for `place` from `today` (the hours already gone are left out). */
export function demoForecast(place: string, today: ISODate, now: Date): WeatherForecast {
  const hours = Array.from({ length: FORECAST_DAYS }, (_, i) => addDays(today, i)).flatMap((date, i) => {
    const pattern = PATTERNS[seed(`${place}|${date}`) % PATTERNS.length] ?? PATTERNS[0];
    const warm = 11 + (seed(date) % 7);
    return dayHours(date, pattern ?? (() => 0), i >= HOURLY_DAYS, warm);
  });
  const fromHour = now.getHours();
  return { place, source: 'demo', updatedAt: now.toISOString(), hours: hours.filter((h) => h.date !== today || h.hour >= fromHour) };
}

export function weatherDemo({ store }: DemoDeps): WeatherMethods {
  return {
    async getWeather() {
      const me = await requireMe(store);
      const place = (await store.read()).profiles.find((p) => p.id === me)?.weatherPlace ?? null;
      if (!place) return null;
      const clock = store.clock();
      return demoForecast(place.name, clock.today, new Date(clock.now));
    },
    async searchWeatherPlaces(query) {
      await requireMe(store);
      const clean = query.replace(/\s+/g, ' ').trim();
      if (clean.length < 2 || clean.length > 80) throw new RepositoryError('validation', 'Escribe el nombre de tu ciudad (entre 2 y 80 caracteres).');
      return searchDemoPlaces(clean);
    },
  };
}
