/**
 * City search for "Tu ciudad para el tiempo" through Nominatim (OpenStreetMap,
 * ODbL: the app shows "© colaboradores de OpenStreetMap"). Usage policy
 * honoured here: only when the athlete taps "Buscar" (no autocomplete),
 * identifying User-Agent, results cached for 30 days (`geocode_results`), at
 * most one request per second for the whole app (`svc_reserve_provider_call`),
 * and the provider can be switched on the server (`GEOCODER_URL`) without an
 * app update. Only the typed text leaves our server, never who typed it.
 */
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import type { FetchLike, GeocodeCache, PlaceResult, ProviderThrottle } from './ports.ts';
import { WEATHER_USER_AGENT, WeatherError } from './ports.ts';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_MIN_INTERVAL_MS = 1_100;
export const GEOCODE_TTL_MS = 30 * 86_400_000;
export const GEOCODE_TIMEOUT_MS = 8_000;
export const QUERY_MIN = 2;
export const QUERY_MAX = 80;
const MAX_RESULTS = 6;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

/** Cache key and what is sent: trimmed, single spaces, lower case; null when too short or too long. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
  return clean.length >= QUERY_MIN && clean.length <= QUERY_MAX ? clean : null;
}

function coord(v: unknown, limit: number): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 10_000) / 10_000 : null;
}

function placeOf(raw: unknown): PlaceResult | null {
  if (!isObj(raw)) return null;
  const lat = coord(raw.lat, 90);
  const lon = coord(raw.lon, 180);
  const address = isObj(raw.address) ? raw.address : {};
  const name = text(raw.name) ?? text(address.city) ?? text(address.town) ?? text(address.village) ?? text(raw.display_name)?.split(',')[0]?.trim() ?? null;
  if (lat === null || lon === null || !name) return null;
  const region = text(address.state) ?? text(address.province) ?? text(address.county);
  const detail = [...new Set([region, text(address.country)])].filter((x): x is string => x !== null && x !== name).join(', ');
  return { name, detail, lat, lon };
}

/** Nominatim `jsonv2` array → places (deduplicated by name and region). */
export function parseNominatim(body: unknown): PlaceResult[] {
  if (!Array.isArray(body)) return [];
  const seen = new Set<string>();
  return body
    .map(placeOf)
    .filter((p): p is PlaceResult => p !== null)
    .filter((p) => {
      const key = `${p.name}|${p.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RESULTS);
}

export interface GeocodeDeps {
  cache: GeocodeCache;
  throttle: ProviderThrottle;
  fetch: FetchLike;
  now: () => Date;
  logger: Logger;
  /** Geocoder endpoint (env GEOCODER_URL): switchable without an app update. */
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One second between calls for the whole app: wait once, then give up (the app says "prueba en unos segundos"). */
async function reserveSlot(deps: GeocodeDeps): Promise<void> {
  if (await deps.throttle.reserve('nominatim', NOMINATIM_MIN_INTERVAL_MS)) return;
  await (deps.sleep ?? defaultSleep)(NOMINATIM_MIN_INTERVAL_MS);
  if (await deps.throttle.reserve('nominatim', NOMINATIM_MIN_INTERVAL_MS)) return;
  throw new WeatherError('rate_limited', 'Hay muchas búsquedas ahora mismo. Prueba en unos segundos.');
}

function searchUrl(base: string, query: string): string {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: String(MAX_RESULTS), 'accept-language': 'es', featureType: 'settlement' });
  return `${base}?${params.toString()}`;
}

async function cachedResults(deps: GeocodeDeps, query: string): Promise<PlaceResult[] | null> {
  try {
    const hit = await deps.cache.get(query);
    return hit && deps.now().getTime() - Date.parse(hit.fetchedAt) < GEOCODE_TTL_MS ? hit.results : null;
  } catch (error) {
    deps.logger.warn('geocode cache read failed', errorInfo(error));
    return null;
  }
}

/** Cities matching `query` (already normalized). Throws WeatherError (rate_limited | unavailable). */
export async function searchPlaces(deps: GeocodeDeps, query: string): Promise<PlaceResult[]> {
  const cached = await cachedResults(deps, query);
  if (cached) return cached;
  await reserveSlot(deps);
  let res: Response;
  try {
    res = await deps.fetch(searchUrl(deps.baseUrl ?? NOMINATIM_URL, query), {
      headers: { 'User-Agent': WEATHER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
  } catch {
    throw new WeatherError('unavailable', 'No se pudo conectar con el buscador de ciudades.');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new WeatherError(res.status === 429 ? 'rate_limited' : 'unavailable', `El buscador de ciudades responde ${res.status}.`);
  }
  const results = parseNominatim(await res.json().catch(() => null));
  try {
    await deps.cache.put(query, results, deps.now().toISOString());
  } catch (error) {
    deps.logger.warn('geocode cache write failed', errorInfo(error));
  }
  return results;
}
