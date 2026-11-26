/**
 * Weather on Supabase: the `weather` edge function (user JWT). `forecast`
 * reads the athlete's city from the profile on the server (MET Norway behind
 * a shared cache) and is a bonus: any failure (offline, not deployed yet,
 * provider down) gives null and the app shows nothing. `search` (Nominatim
 * behind a cache, one request per second for the whole app) throws
 * RepositoryError with a Spanish message so the settings screen can say why.
 */
import { isISODate } from '@/domain/dates';
import type { WeatherPlaceOption } from '@/domain/types';
import type { WeatherForecast, WeatherHour } from '@/domain/weather';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import type { SupabaseCtx } from './base';
import { toFunctionError } from './errors';
import { asArray, asNumber, asString, isRecord } from './narrow';

type WeatherMethods = Required<Pick<Repository, 'getWeather' | 'searchWeatherPlaces'>>;

export const WEATHER_QUERY_MIN = 2;
export const WEATHER_QUERY_MAX = 80;
const SEARCH_FALLBACK = 'No hemos podido buscar tu ciudad. Inténtalo de nuevo.';

function hourOf(raw: unknown): WeatherHour | null {
  if (!isRecord(raw)) return null;
  const date = asString(raw.date);
  const hour = asNumber(raw.hour);
  const precipMm = asNumber(raw.precipMm);
  if (!date || !isISODate(date) || hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23 || precipMm === null) return null;
  const gustKmh = asNumber(raw.gustKmh);
  return {
    date,
    hour,
    tempC: asNumber(raw.tempC),
    windKmh: asNumber(raw.windKmh),
    ...(gustKmh === null ? {} : { gustKmh }),
    precipMm: Math.max(0, precipMm),
    precipProb: asNumber(raw.precipProb),
    symbol: asString(raw.symbol),
    coarse: raw.coarse === true,
  };
}

/** `{ forecast }` of the function → WeatherForecast, or null when absent or malformed. */
export function parseForecast(data: unknown): WeatherForecast | null {
  const raw = isRecord(data) ? data.forecast : null;
  if (!isRecord(raw)) return null;
  const place = asString(raw.place);
  if (!place) return null;
  const hours = asArray(raw.hours).map(hourOf).filter((h): h is WeatherHour => h !== null);
  return { place, source: raw.source === 'demo' ? 'demo' : 'met_norway', updatedAt: asString(raw.updatedAt) ?? '', hours };
}

/** `{ places }` of the function → cities (bad rows dropped). */
export function parsePlaces(data: unknown): WeatherPlaceOption[] {
  const raw = isRecord(data) ? asArray(data.places) : [];
  return raw.flatMap((p) => {
    if (!isRecord(p)) return [];
    const name = asString(p.name)?.trim();
    const lat = asNumber(p.lat);
    const lon = asNumber(p.lon);
    if (!name || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{ name: name.slice(0, 120), detail: asString(p.detail)?.trim() ?? '', lat, lon }];
  });
}

/** A function that is not deployed yet answers 404: say so instead of "no hemos encontrado…". */
function searchError(error: RepositoryError): RepositoryError {
  if (error.code !== 'not_found') return error;
  return new RepositoryError('unavailable', 'La búsqueda de ciudades aún no está disponible. Inténtalo más tarde.', error);
}

export function weatherApi(ctx: SupabaseCtx): WeatherMethods {
  async function invoke(body: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    return ctx.client.functions.invoke('weather', { body });
  }

  async function getWeather(): Promise<WeatherForecast | null> {
    try {
      const { data, error } = await invoke({ action: 'forecast' });
      if (error) {
        logger.info('weather: forecast unavailable', (await toFunctionError(error, 'weather')).code);
        return null;
      }
      return parseForecast(data);
    } catch (error) {
      logger.info('weather: forecast unavailable', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async function searchWeatherPlaces(query: string): Promise<WeatherPlaceOption[]> {
    const clean = query.replace(/\s+/g, ' ').trim();
    if (clean.length < WEATHER_QUERY_MIN || clean.length > WEATHER_QUERY_MAX) {
      throw new RepositoryError('validation', 'Escribe el nombre de tu ciudad (entre 2 y 80 caracteres).');
    }
    let response: { data: unknown; error: unknown };
    try {
      response = await invoke({ action: 'search', query: clean });
    } catch (error) {
      throw searchError(await toFunctionError(error, SEARCH_FALLBACK));
    }
    if (response.error) throw searchError(await toFunctionError(response.error, SEARCH_FALLBACK));
    return parsePlaces(response.data);
  }

  return { getWeather, searchWeatherPlaces };
}
