/**
 * MET Norway Locationforecast 2.0 (`/compact`): free, commercial use allowed
 * (NLOD 2.0 / CC BY 4.0, credit "MET Norway"). Terms honoured here:
 * - identifying User-Agent (`WEATHER_USER_AGENT`);
 * - coordinates with at most 4 decimals (we send 2: ~1 km, also the cache key);
 * - never ask again before `Expires`, and send `If-Modified-Since` with the last
 *   `Last-Modified` (304 = keep the cached copy); we also wait at least
 *   `MET_MIN_REFRESH_MS` per coordinate (outside the Nordic area the model is
 *   updated every few hours);
 * - only on demand (the athlete opens the app, a briefing or the coach), never on a schedule.
 * Outside the Nordic area there is no chance of rain: only amounts and symbols.
 * Gusts (`wind_speed_of_gust`) only come in `/complete` and only in the Nordic
 * area (checked 2026-11: Madrid none, Oslo the hourly steps): `/compact`
 * never has them, so `gust` is parsed when present and null otherwise, and
 * the wind rules lean on the 10-minute mean.
 */
import type { CachedForecast, FetchLike, ForecastPoint } from './ports.ts';
import { WEATHER_USER_AGENT, WeatherError } from './ports.ts';

export const MET_FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
/** Minimum time between two requests for the same coordinates. */
export const MET_MIN_REFRESH_MS = 90 * 60_000;
export const MET_TIMEOUT_MS = 10_000;
/** Ten days of steps is all MET gives; anything beyond is ignored. */
const MAX_POINTS = 120;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rounded to 2 decimals: the cache key and what MET receives. */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Period {
  mm: number;
  prob: number | null;
  sym: string | null;
}

function periodOf(raw: unknown): Period | null {
  if (!isObj(raw)) return null;
  const details = isObj(raw.details) ? raw.details : {};
  const summary = isObj(raw.summary) ? raw.summary : {};
  const mm = num(details.precipitation_amount);
  if (mm === null) return null;
  const prob = num(details.probability_of_precipitation);
  const sym = typeof summary.symbol_code === 'string' ? summary.symbol_code.slice(0, 60) : null;
  return { mm: Math.max(0, mm), prob: prob === null ? null : Math.min(100, Math.max(0, prob)), sym };
}

function pointOf(raw: unknown): ForecastPoint | null {
  if (!isObj(raw) || typeof raw.time !== 'string' || !Number.isFinite(Date.parse(raw.time))) return null;
  const data = isObj(raw.data) ? raw.data : {};
  const instant = isObj(data.instant) && isObj(data.instant.details) ? data.instant.details : {};
  const hourly = periodOf(data.next_1_hours);
  const block = hourly ? null : periodOf(data.next_6_hours);
  const period = hourly ?? block;
  if (!period) return null;
  const wind = num(instant.wind_speed);
  const gust = num(instant.wind_speed_of_gust);
  return {
    t: new Date(raw.time).toISOString(),
    temp: num(instant.air_temperature),
    wind: wind === null ? null : Math.round(wind * 3.6),
    ...(gust === null ? {} : { gust: Math.round(gust * 3.6) }),
    mm: period.mm,
    prob: period.prob,
    sym: period.sym,
    h: hourly ? 1 : 6,
  };
}

/** Defensive parse of a Locationforecast JSON body; null when it is not one. */
export function parseMetForecast(body: unknown): { points: ForecastPoint[]; issuedAt: string | null } | null {
  if (!isObj(body) || !isObj(body.properties) || !Array.isArray(body.properties.timeseries)) return null;
  const meta = isObj(body.properties.meta) ? body.properties.meta : {};
  const issued = typeof meta.updated_at === 'string' && Number.isFinite(Date.parse(meta.updated_at)) ? new Date(meta.updated_at).toISOString() : null;
  const points = body.properties.timeseries
    .slice(0, MAX_POINTS)
    .map(pointOf)
    .filter((p): p is ForecastPoint => p !== null);
  return { points, issuedAt: issued };
}

/** `Expires` (HTTP date), never sooner than the minimum refresh interval. */
export function nextFetchAt(expires: string | null, now: Date): string {
  const floor = now.getTime() + MET_MIN_REFRESH_MS;
  const parsed = expires ? Date.parse(expires) : Number.NaN;
  return new Date(Number.isFinite(parsed) ? Math.max(parsed, floor) : floor).toISOString();
}

export type MetFetch =
  | { kind: 'fresh'; points: ForecastPoint[]; issuedAt: string | null; expiresAt: string; lastModified: string | null }
  | { kind: 'not_modified'; expiresAt: string };

export interface MetRequest {
  lat: number;
  lon: number;
  /** Last-Modified of the cached copy (If-Modified-Since). */
  lastModified: string | null;
  now: Date;
  baseUrl?: string;
  timeoutMs?: number;
}

/** One request to MET. Throws WeatherError('unavailable') for anything but 200/304 with a usable body. */
export async function fetchMetForecast(fetchFn: FetchLike, req: MetRequest): Promise<MetFetch> {
  const url = `${req.baseUrl ?? MET_FORECAST_URL}?lat=${roundCoord(req.lat).toFixed(2)}&lon=${roundCoord(req.lon).toFixed(2)}`;
  const headers: Record<string, string> = { 'User-Agent': WEATHER_USER_AGENT, Accept: 'application/json' };
  if (req.lastModified) headers['If-Modified-Since'] = req.lastModified;
  let res: Response;
  try {
    res = await fetchFn(url, { headers, signal: AbortSignal.timeout(req.timeoutMs ?? MET_TIMEOUT_MS) });
  } catch {
    throw new WeatherError('unavailable', 'No se pudo conectar con MET Norway.');
  }
  const expiresAt = nextFetchAt(res.headers.get('expires'), req.now);
  if (res.status === 304) return { kind: 'not_modified', expiresAt };
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new WeatherError(res.status === 429 ? 'rate_limited' : 'unavailable', `MET Norway responde ${res.status}.`);
  }
  const parsed = parseMetForecast(await res.json().catch(() => null));
  if (!parsed || parsed.points.length === 0) throw new WeatherError('unavailable', 'Respuesta de MET Norway no válida.');
  return { kind: 'fresh', ...parsed, expiresAt, lastModified: res.headers.get('last-modified') };
}

/** The cache row after a request (304 keeps the points and only moves the expiry). */
export function cacheRowAfter(previous: CachedForecast | null, lat: number, lon: number, result: MetFetch, now: Date): CachedForecast | null {
  const fetchedAt = now.toISOString();
  if (result.kind === 'not_modified') return previous ? { ...previous, fetchedAt, expiresAt: result.expiresAt } : null;
  return {
    lat: roundCoord(lat),
    lon: roundCoord(lon),
    points: result.points,
    issuedAt: result.issuedAt,
    fetchedAt,
    expiresAt: result.expiresAt,
    lastModified: result.lastModified,
  };
}
