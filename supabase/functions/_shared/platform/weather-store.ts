/**
 * Weather ports over supabase-js (service role): the athlete's city (its own
 * select, so profile reads elsewhere never depend on the weather columns),
 * the forecast and city-search caches (`20261126000500_weather.sql`, no client
 * access) and the global spacing between provider calls (`svc_reserve_provider_call`).
 */
import type { UUID } from '../types.ts';
import type { AthletePlace, CachedForecast, ForecastCache, ForecastPoint, GeocodeCache, PlaceResult, PlaceStore, ProviderThrottle } from '../weather/ports.ts';
import { unwrap } from './db.ts';
import type { Db } from './db.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function createPlaceStore(db: Db): PlaceStore {
  return {
    async getPlace(userId: UUID): Promise<AthletePlace | null> {
      const row = unwrap(
        await db.from('profiles').select('weather_place,weather_lat,weather_lon,timezone').eq('id', userId).maybeSingle(),
        'weather place',
      );
      if (!isObj(row)) return null;
      const name = str(row.weather_place);
      const lat = num(row.weather_lat);
      const lon = num(row.weather_lon);
      if (!name || lat === null || lon === null) return null;
      return { name, lat, lon, timezone: str(row.timezone) ?? 'Europe/Madrid' };
    },
  };
}

function pointsOf(v: unknown): ForecastPoint[] {
  return Array.isArray(v) ? (v.filter((p) => isObj(p) && typeof p.t === 'string') as ForecastPoint[]) : [];
}

export function createForecastCache(db: Db): ForecastCache {
  return {
    async get(lat, lon): Promise<CachedForecast | null> {
      const row = unwrap(
        await db
          .from('weather_forecasts')
          .select('lat,lon,points,issued_at,fetched_at,expires_at,last_modified')
          .eq('lat', lat)
          .eq('lon', lon)
          .maybeSingle(),
        'weather forecast',
      );
      if (!isObj(row) || !str(row.fetched_at) || !str(row.expires_at)) return null;
      return {
        lat,
        lon,
        points: pointsOf(row.points),
        issuedAt: str(row.issued_at),
        fetchedAt: String(row.fetched_at),
        expiresAt: String(row.expires_at),
        lastModified: str(row.last_modified),
      };
    },
    async put(row) {
      unwrap(
        await db.from('weather_forecasts').upsert(
          {
            lat: row.lat,
            lon: row.lon,
            points: row.points,
            issued_at: row.issuedAt,
            fetched_at: row.fetchedAt,
            expires_at: row.expiresAt,
            last_modified: row.lastModified,
          },
          { onConflict: 'lat,lon' },
        ),
        'weather forecast upsert',
      );
    },
  };
}

function placesOf(v: unknown): PlaceResult[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is PlaceResult => isObj(p) && typeof p.name === 'string' && typeof p.lat === 'number' && typeof p.lon === 'number');
}

export function createGeocodeCache(db: Db): GeocodeCache {
  return {
    async get(query) {
      const row = unwrap(await db.from('geocode_results').select('results,fetched_at').eq('query', query).maybeSingle(), 'geocode cache');
      return isObj(row) && str(row.fetched_at) ? { results: placesOf(row.results), fetchedAt: String(row.fetched_at) } : null;
    },
    async put(query, results, fetchedAt) {
      unwrap(await db.from('geocode_results').upsert({ query, results, fetched_at: fetchedAt }, { onConflict: 'query' }), 'geocode cache upsert');
    },
  };
}

export function createProviderThrottle(db: Db): ProviderThrottle {
  return {
    async reserve(provider, minIntervalMs) {
      const data = unwrap(await db.rpc('svc_reserve_provider_call', { p_provider: provider, p_min_interval_ms: minIntervalMs }), 'svc_reserve_provider_call');
      return data === true;
    },
  };
}
