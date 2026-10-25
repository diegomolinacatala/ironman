/**
 * Garmin Personal API integration: POST { action: connect | disconnect | sync | sync_all }.
 * connect/disconnect/sync need the user JWT; sync_all needs a server secret key (pg_cron).
 * verify_jwt = false (sync_all is called with an `apikey` only); user actions verify the JWT in code.
 */
import { GARMIN_BASE_URL, createGarminApi } from '../_shared/garmin/api.ts';
import { handleGarminHttp } from '../_shared/garmin/http.ts';
import { bearerToken } from '../_shared/http.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';
import { createCredentialStore } from '../_shared/platform/service-stores.ts';
import { secretKeysFromEnv } from '../_shared/secrets.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('garmin', env);
const secretKeys = secretKeysFromEnv(env);
const api = createGarminApi((input, init) => fetch(input, init), env('GARMIN_PERSONAL_API_BASE_URL') || GARMIN_BASE_URL);
const store = db ? createPlanningStore(db, systemNow) : null;
const credentials = db ? createCredentialStore(db) : null;

Deno.serve((req: Request) => {
  if (!db || !store || !credentials) return misconfigured();
  return handleGarminHttp(req, {
    api,
    store,
    credentials,
    keySecret: env('GARMIN_KEY_SECRET'),
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    secretKeys,
    now: systemNow,
    logger,
  });
});
