/**
 * HTTP layer of `POST /weather` (user JWT verified in code):
 * - `{ action: 'forecast' }` → `200 { forecast: WeatherForecast | null }` (null: no city set).
 *   The coordinates come from the athlete's profile, never from the request,
 *   so the function cannot be used as a free weather proxy.
 * - `{ action: 'search', query }` → `200 { places: PlaceResult[] }` (2–80 characters).
 * Errors `{ error, message }`: 401, 400, 405, 413, 429 rate_limited (city searches of the whole
 * app are spaced one second apart), 503 weather_unavailable (provider down and nothing cached), 500.
 * Logs never contain the city, the query or the coordinates.
 */
import { bodyErrorResponse, errorResponse, json, methodNotAllowed, preflight, readJson } from '../http.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { UUID } from '../types.ts';
import { normalizeQuery, searchPlaces } from './geocode.ts';
import type { GeocodeDeps } from './geocode.ts';
import type { PlaceStore } from './ports.ts';
import { WeatherError } from './ports.ts';
import { forecastForPlace } from './service.ts';
import type { ForecastDeps } from './service.ts';

const MAX_BODY_BYTES = 2 * 1024;

export const WEATHER_UNAVAILABLE_MESSAGE = 'El servicio del tiempo no responde ahora mismo. Prueba más tarde.';
export const BAD_QUERY_MESSAGE = 'Escribe el nombre de tu ciudad (entre 2 y 80 caracteres).';

export interface WeatherHttpDeps {
  authenticate: (req: Request) => Promise<UUID | null>;
  places: PlaceStore;
  forecast: ForecastDeps;
  geocode: GeocodeDeps;
  logger: Logger;
}

export type WeatherRequest = { action: 'forecast' } | { action: 'search'; query: string };

export function parseWeatherRequest(input: unknown): WeatherRequest | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (body.action === 'forecast') return { action: 'forecast' };
  if (body.action !== 'search') return null;
  const query = normalizeQuery(body.query);
  return query ? { action: 'search', query } : null;
}

function failure(error: unknown, logger: Logger): Response {
  if (error instanceof WeatherError) {
    logger.info('weather provider failed', { code: error.code });
    return error.code === 'rate_limited'
      ? errorResponse(429, 'rate_limited', error.message)
      : errorResponse(503, 'weather_unavailable', WEATHER_UNAVAILABLE_MESSAGE);
  }
  logger.error('weather request failed', errorInfo(error));
  return errorResponse(500, 'internal', 'No se pudo consultar el tiempo. Inténtalo de nuevo.');
}

async function route(req: Request, deps: WeatherHttpDeps): Promise<Response> {
  const userId = await deps.authenticate(req);
  if (!userId) return errorResponse(401, 'unauthorized', 'Inicia sesión de nuevo.');
  const parsed = parseWeatherRequest(await readJson(req, MAX_BODY_BYTES));
  if (!parsed) return errorResponse(400, 'bad_request', BAD_QUERY_MESSAGE);
  if (parsed.action === 'search') return json({ places: await searchPlaces(deps.geocode, parsed.query) }, 200, { 'Cache-Control': 'no-store' });
  const place = await deps.places.getPlace(userId);
  if (!place) return json({ forecast: null }, 200, { 'Cache-Control': 'no-store' });
  return json({ forecast: await forecastForPlace(deps.forecast, place) }, 200, { 'Cache-Control': 'no-store' });
}

export async function handleWeatherHttp(req: Request, deps: WeatherHttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  try {
    return await route(req, deps);
  } catch (error) {
    return bodyErrorResponse(error) ?? failure(error, deps.logger);
  }
}
