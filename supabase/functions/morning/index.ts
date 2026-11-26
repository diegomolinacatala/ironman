/**
 * Wake-up sweep for "Tu informe de hoy" (verify_jwt = false; `apikey` must be a server
 * secret key). pg_cron calls it every 5 minutes through private.morning_wake_tick() while
 * some athlete in wake mode is in their morning. Garmin athletes get a light pull of today's
 * sleep (needs GARMIN_KEY_SECRET, like the `garmin` function); everyone else is decided on
 * the nights already in daily_metrics (Apple Salud / COROS arrive when the app syncs).
 */
import { GARMIN_BASE_URL, createGarminApi } from '../_shared/garmin/api.ts';
import { pullTodaySleep } from '../_shared/garmin/sleep-pull.ts';
import { handleMorningHttp } from '../_shared/morning/http.ts';
import type { SleepPuller } from '../_shared/morning/sweep.ts';
import { createMorningStore } from '../_shared/platform/morning-store.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createCredentialStore } from '../_shared/platform/service-stores.ts';
import { secretKeysFromEnv } from '../_shared/secrets.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('morning', env);
const secretKeys = secretKeysFromEnv(env);
const keySecret = env('GARMIN_KEY_SECRET');
const api = createGarminApi((input, init) => fetch(input, init), env('GARMIN_PERSONAL_API_BASE_URL') || GARMIN_BASE_URL);
const store = db ? createMorningStore(db) : null;

function sleepPuller(): SleepPuller | null {
  if (!db || !keySecret || keySecret.length < 16) return null;
  const deps = { api, store: createPlanningStore(db, systemNow), credentials: createCredentialStore(db), keySecret, now: systemNow, logger };
  return (userId, timezone, today) => pullTodaySleep(deps, userId, timezone, today);
}

const pullSleep = sleepPuller();
if (!pullSleep) logger.warn('GARMIN_KEY_SECRET missing: the wake-up sweep will not pull Garmin sleep');

Deno.serve((req: Request) => {
  if (!db || !store) return misconfigured();
  return handleMorningHttp(req, { store, pullSleep, secretKeys, now: systemNow, logger });
});
