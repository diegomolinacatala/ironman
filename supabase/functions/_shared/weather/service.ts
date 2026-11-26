/**
 * The forecast of the athlete's city, shared by the `weather` function (the
 * app reads it), the morning briefing and the coach: cache first (one row per
 * rounded coordinate pair, `weather_forecasts`), MET Norway only when the row
 * expired (If-Modified-Since), a stale copy (< 24 h) when MET fails, and the
 * UTC steps turned into the athlete's local hours (6-hour blocks spread over
 * their hours, temperature interpolated). Best effort for the AI paths:
 * `safeForecast` never throws and is bounded in time.
 */
import { localParts } from '../dates.ts';
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { WeatherForecast, WeatherHour } from '../planning/domain/weather.ts';
import type { UUID } from '../types.ts';
import { cacheRowAfter, fetchMetForecast, roundCoord } from './met.ts';
import type { AthletePlace, CachedForecast, FetchLike, ForecastCache, ForecastPoint, PlaceStore } from './ports.ts';
import { WeatherError } from './ports.ts';

/** A stale copy still beats nothing for a while when MET fails. */
export const STALE_OK_MS = 24 * 3600_000;
/** Days of forecast handed out (MET gives ~9.5). */
export const FORECAST_DAYS = 9;
const HOUR_MS = 3600_000;

export interface ForecastDeps {
  cache: ForecastCache;
  fetch: FetchLike;
  now: () => Date;
  logger: Logger;
  /** MET endpoint override (tests). */
  baseUrl?: string;
}

async function store(deps: ForecastDeps, row: CachedForecast): Promise<void> {
  try {
    await deps.cache.put(row);
  } catch (error) {
    deps.logger.warn('weather cache write failed', errorInfo(error));
  }
}

/** The cached row of the place, refreshed from MET when it expired. Throws WeatherError when there is nothing to serve. */
export async function cachedForecast(deps: ForecastDeps, lat: number, lon: number): Promise<CachedForecast> {
  const key = { lat: roundCoord(lat), lon: roundCoord(lon) };
  const now = deps.now();
  const cached = await deps.cache.get(key.lat, key.lon);
  if (cached && Date.parse(cached.expiresAt) > now.getTime()) return cached;
  try {
    const result = await fetchMetForecast(deps.fetch, { ...key, lastModified: cached?.lastModified ?? null, now, baseUrl: deps.baseUrl });
    const row = cacheRowAfter(cached, key.lat, key.lon, result, now);
    if (!row) throw new WeatherError('unavailable', 'MET Norway respondió 304 sin copia guardada.');
    await store(deps, row);
    return row;
  } catch (error) {
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < STALE_OK_MS) {
      deps.logger.info('weather: serving a stale forecast', errorInfo(error));
      return cached;
    }
    throw error instanceof WeatherError ? error : new WeatherError('unavailable', 'El servicio del tiempo no responde.');
  }
}

function interpolate(from: number | null, to: number | null | undefined, fraction: number): number | null {
  if (from === null) return null;
  if (to === null || to === undefined || fraction === 0) return from;
  return Math.round((from + (to - from) * fraction) * 10) / 10;
}

/** UTC steps → the athlete's local hours from the current hour, `days` ahead. */
export function localHours(points: readonly ForecastPoint[], tz: string, from: Date, days: number): WeatherHour[] {
  const start = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS;
  const end = from.getTime() + days * 24 * HOUR_MS;
  const out: WeatherHour[] = [];
  points.forEach((p, index) => {
    const t0 = Date.parse(p.t);
    const next = points[index + 1];
    for (let k = 0; k < p.h; k += 1) {
      const t = t0 + k * HOUR_MS;
      if (t < start || t >= end) continue;
      const local = localParts(new Date(t), tz);
      out.push({
        date: local.date,
        hour: Number(local.time.slice(0, 2)),
        tempC: p.h > 1 ? interpolate(p.temp, next?.temp, k / p.h) : p.temp,
        windKmh: p.wind,
        ...(typeof p.gust === 'number' ? { gustKmh: p.gust } : {}),
        precipMm: Math.round((p.mm / p.h) * 100) / 100,
        precipProb: p.prob,
        symbol: p.sym,
        coarse: p.h > 1,
      });
    }
  });
  return out;
}

/** The athlete's forecast (local hours) for the app, the briefing and the coach. */
export async function forecastForPlace(deps: ForecastDeps, place: AthletePlace): Promise<WeatherForecast> {
  const row = await cachedForecast(deps, place.lat, place.lon);
  return {
    place: place.name,
    source: 'met_norway',
    updatedAt: row.issuedAt ?? row.fetchedAt,
    hours: localHours(row.points, place.timezone, deps.now(), FORECAST_DAYS),
  };
}

export interface WeatherReader {
  /** Null when the athlete has no city. Throws WeatherError when the provider fails and nothing is cached. */
  forecastFor(userId: UUID): Promise<WeatherForecast | null>;
}

export function createWeatherReader(deps: ForecastDeps & { places: PlaceStore }): WeatherReader {
  return {
    async forecastFor(userId) {
      const place = await deps.places.getPlace(userId);
      return place ? forecastForPlace(deps, place) : null;
    },
  };
}

export const SAFE_FORECAST_TIMEOUT_MS = 8_000;

/** For the briefing and the coach: the forecast or null, never an error, never longer than the timeout. */
export async function safeForecast(reader: WeatherReader | null | undefined, userId: UUID, logger: Logger, timeoutMs = SAFE_FORECAST_TIMEOUT_MS): Promise<WeatherForecast | null> {
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([reader.forecastFor(userId), timeout]);
  } catch (error) {
    logger.info('weather unavailable for the context', errorInfo(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
