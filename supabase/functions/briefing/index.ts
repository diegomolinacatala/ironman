/**
 * Morning briefing ("Informe de hoy"): POST { date, refresh? } with the user JWT → 200 Briefing.
 * verify_jwt = false in config.toml; the JWT is verified in code (userIdFromJwt), like `garmin`.
 * Returns the stored row when present (no API key needed); otherwise refreshes Garmin when stale,
 * asks the AI (Workers AI or Claude; effort low, structured output) and upserts `briefings`.
 */
import { handleBriefingHttp } from '../_shared/briefing/http.ts';
import type { GarminRefresher } from '../_shared/briefing/ports.ts';
import { createGarminApi, GARMIN_BASE_URL } from '../_shared/garmin/api.ts';
import { syncWithCredential } from '../_shared/garmin/credentials.ts';
import { bearerToken } from '../_shared/http.ts';
import { createAiPort } from '../_shared/platform/ai-provider.ts';
import { createBriefingStore } from '../_shared/platform/briefing-store.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createAiUsageStore, createCredentialStore } from '../_shared/platform/service-stores.ts';
import { createForecastCache, createPlaceStore } from '../_shared/platform/weather-store.ts';
import { MET_FORECAST_URL } from '../_shared/weather/met.ts';
import { createWeatherReader } from '../_shared/weather/service.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('briefing', env);
// Workers AI (free) when AI_WORKER_URL + AI_WORKER_SECRET are set; else Claude; else null (503).
const claude = createAiPort(env, 'text', logger);
const reader = db ? createPlanningStore(db, systemNow) : null;
const briefings = db ? createBriefingStore(db) : null;
const usage = db ? createAiUsageStore(db) : null;
// The athlete's city forecast (MET Norway, cached): one sentence when today's outdoor session falls in the rain.
const weather = db
  ? createWeatherReader({
      places: createPlaceStore(db),
      cache: createForecastCache(db),
      fetch: (input, init) => fetch(input, init),
      now: systemNow,
      logger,
      baseUrl: env('MET_FORECAST_URL') || MET_FORECAST_URL,
    })
  : null;

function garminRefresher(): GarminRefresher | null {
  const keySecret = env('GARMIN_KEY_SECRET');
  if (!db || !reader || !keySecret || keySecret.length < 16) return null;
  const credentials = createCredentialStore(db);
  const api = createGarminApi((input, init) => fetch(input, init), env('GARMIN_PERSONAL_API_BASE_URL') || GARMIN_BASE_URL);
  return {
    getCredential: (userId) => credentials.getCredential(userId),
    sync: (credential) => syncWithCredential({ api, store: reader, credentials, keySecret, now: systemNow, logger }, credential),
  };
}

const garmin = garminRefresher();

Deno.serve((req: Request) => {
  if (!db || !reader || !briefings || !usage) return misconfigured();
  return handleBriefingHttp(req, {
    reader,
    briefings,
    usage,
    claude,
    garmin,
    weather,
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    now: systemNow,
    logger,
  });
});
