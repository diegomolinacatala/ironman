/**
 * Ports of the weather service: the athlete's city (profile columns), the
 * forecast cache (`weather_forecasts`, keyed by the coordinates rounded to
 * 2 decimals), the city search cache (`geocode_results`), the global spacing
 * between calls to a provider (`svc_reserve_provider_call`) and the errors
 * the HTTP layer turns into answers. No Deno globals.
 */
import type { UUID } from '../types.ts';

/**
 * Identifies the app to MET Norway and Nominatim (both require an app name plus a way to reach
 * the developer): the public support page, which has the contact (docs/APP_STORE.md).
 */
export const WEATHER_USER_AGENT = 'RoadToIronman/1.0 (+https://diegomolinacatala.github.io/ironman/)';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AthletePlace {
  name: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface PlaceStore {
  /** The athlete's city and timezone; null when no city is set (or the columns do not exist yet). */
  getPlace(userId: UUID): Promise<AthletePlace | null>;
}

/** One forecast step as MET gives it (UTC), compact for the cache. */
export interface ForecastPoint {
  /** ISO instant (UTC) where the step starts. */
  t: string;
  /** °C at `t`. */
  temp: number | null;
  /** km/h at `t` (10-minute mean). */
  wind: number | null;
  /** Strongest gust, km/h, when MET gives it (`/complete`, Nordic area); absent otherwise. */
  gust?: number | null;
  /** Precipitation over the step, mm. */
  mm: number;
  /** Chance of precipitation over the step, %, when MET gives it (Nordic area). */
  prob: number | null;
  sym: string | null;
  /** Step length in hours: 1 (first ~60 h) or 6. */
  h: 1 | 6;
}

export interface CachedForecast {
  /** Rounded to 2 decimals (the cache key and the coordinates sent to MET). */
  lat: number;
  lon: number;
  points: ForecastPoint[];
  /** When MET issued the forecast (meta.updated_at). */
  issuedAt: string | null;
  fetchedAt: string;
  /** Never ask MET again before this (Expires, and at least the minimum refresh interval). */
  expiresAt: string;
  /** Last-Modified of the response, sent back as If-Modified-Since. */
  lastModified: string | null;
}

export interface ForecastCache {
  get(lat: number, lon: number): Promise<CachedForecast | null>;
  put(row: CachedForecast): Promise<void>;
}

/** A city the athlete can pick. */
export interface PlaceResult {
  /** "Valencia". */
  name: string;
  /** "Valencia, España". */
  detail: string;
  lat: number;
  lon: number;
}

export interface GeocodeCache {
  get(query: string): Promise<{ results: PlaceResult[]; fetchedAt: string } | null>;
  put(query: string, results: PlaceResult[], fetchedAt: string): Promise<void>;
}

export interface ProviderThrottle {
  /** True when a call to `provider` may go now (and reserves it); false when the last one is too recent. */
  reserve(provider: 'nominatim' | 'met_norway', minIntervalMs: number): Promise<boolean>;
}

export type WeatherErrorCode = 'rate_limited' | 'unavailable';

/** Provider refused, failed or is busy: the HTTP layer answers 429 or 503 (the app shows nothing). */
export class WeatherError extends Error {
  readonly code: WeatherErrorCode;
  constructor(code: WeatherErrorCode, message: string) {
    super(message);
    this.name = 'WeatherError';
    this.code = code;
  }
}
