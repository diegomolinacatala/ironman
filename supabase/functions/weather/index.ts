/**
 * Weather for outdoor training: POST { action: 'forecast' } → { forecast } (the athlete's city,
 * MET Norway Locationforecast 2.0, cached per rounded coordinates) and POST { action: 'search',
 * query } → { places } (Nominatim / OpenStreetMap, cached, one request per second for the whole app).
 * verify_jwt = false in config.toml; the JWT is verified in code (userIdFromJwt), like `briefing`.
 * GEOCODER_URL / MET_FORECAST_URL override the providers (switchable without an app update).
 */
import { bearerToken } from '../_shared/http.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createForecastCache, createGeocodeCache, createPlaceStore, createProviderThrottle } from '../_shared/platform/weather-store.ts';
import { NOMINATIM_URL } from '../_shared/weather/geocode.ts';
import { handleWeatherHttp } from '../_shared/weather/http.ts';
import { MET_FORECAST_URL } from '../_shared/weather/met.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('weather', env);
const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

Deno.serve((req: Request) => {
  if (!db) return misconfigured();
  return handleWeatherHttp(req, {
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    places: createPlaceStore(db),
    forecast: { cache: createForecastCache(db), fetch: fetchFn, now: systemNow, logger, baseUrl: env('MET_FORECAST_URL') || MET_FORECAST_URL },
    geocode: {
      cache: createGeocodeCache(db),
      throttle: createProviderThrottle(db),
      fetch: fetchFn,
      now: systemNow,
      logger,
      baseUrl: env('GEOCODER_URL') || NOMINATIM_URL,
    },
    logger,
  });
});
